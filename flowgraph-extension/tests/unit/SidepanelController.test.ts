import { describe, expect, it, vi } from 'vitest';
import { createSidepanelController, extractProjectId } from '../../src/ui/sidepanel/controller';
const healthy = { account: { state: 'CONNECTED' as const }, flow: { state: 'READY' as const, projectId: 'a' } };
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
function setup() {
  const adapter = { healthCheck: vi.fn().mockResolvedValue(healthy),
    listProjects: vi.fn().mockResolvedValue({ projects: [{ projectId: 'a', projectTitle: 'A' }, { projectId: 'b', projectTitle: 'B' }], source: 'runtime' }),
    selectProject: vi.fn().mockResolvedValue({ projectId: 'b', selectedAt: 'now' }),
    createProject: vi.fn().mockResolvedValue({ projectId: 'c', projectTitle: 'C' }) };
  const studioOpen = vi.fn().mockResolvedValue(false);
  const controller = createSidepanelController(adapter, studioOpen);
  return { adapter, studioOpen, controller };
}
describe('Sidepanel controller', () => {
  it('shows partial source and discards a list arriving after Flow changes', async () => {
    const { adapter, controller } = setup();
    adapter.listProjects.mockResolvedValueOnce({ projects: [{ projectId: 'a', projectTitle: 'A' }], source: 'flow-dom', partial: true });
    await controller.loadProjects();
    expect(controller.getSnapshot().projectsError).toContain('đang tải');
    const pending = deferred<{ projects: Array<{ projectId: string; projectTitle: string }>; source: string }>();
    adapter.listProjects.mockReturnValueOnce(pending.promise);
    const work = controller.loadProjects();
    controller.flowChanged({ state: 'PROJECT_REQUIRED' });
    pending.resolve({ projects: [{ projectId: 'old', projectTitle: 'Old' }], source: 'runtime' });
    await work;
    expect(controller.getSnapshot().projects).toEqual([]);
    expect(controller.getSnapshot().projectsLoaded).toBe(false);
    expect(controller.getSnapshot().projectsLoading).toBe(false);
  });
  it('retains a created project after select failure and retries select without another create, even after list refresh', async () => {
    const { adapter, controller } = setup();
    adapter.selectProject.mockRejectedValueOnce(new Error('navigation failed'));
    await controller.createProject('C');
    expect(controller.getSnapshot().projectsError).toContain('navigation failed');
    await controller.loadProjects();
    expect(controller.getSnapshot().projects.some(p => p.projectId === 'c')).toBe(true);
    adapter.selectProject.mockResolvedValue({ projectId: 'c', selectedAt: 'now' });
    adapter.healthCheck.mockResolvedValue({ ...healthy, flow: { state: 'READY', projectId: 'c' } });
    await controller.createProject('C');
    expect(adapter.createProject).toHaveBeenCalledTimes(1);
    expect(adapter.selectProject).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().projectsError).toBeUndefined();
  });
  it('does not select after a run starts and finishes while create is pending', async () => {
    const { adapter, controller } = setup();
    const pending = deferred<{ projectId: string; projectTitle: string }>();
    adapter.createProject.mockReturnValueOnce(pending.promise);
    const work = controller.createProject('C');
    controller.runtimeEvent({ kind: 'run:state', runId: 'new', status: 'running' });
    controller.runtimeEvent({ kind: 'run:state', runId: 'new', status: 'success' });
    pending.resolve({ projectId: 'c', projectTitle: 'C' });
    await work;
    expect(adapter.selectProject).not.toHaveBeenCalled();
    expect(controller.getSnapshot().projects.some(p => p.projectId === 'c')).toBe(true);
    expect(controller.getSnapshot().projectsError).toContain('thay đổi');
  });
  it('rejects a run epoch change during the select guard even if the run has finished', async () => {
    const { adapter, studioOpen, controller } = setup();
    await controller.loadProjects();
    const pending = deferred<boolean>();
    studioOpen.mockReturnValueOnce(pending.promise);
    const work = controller.selectProject('b');
    controller.runtimeEvent({ kind: 'run:state', runId: 'new', status: 'running' });
    controller.runtimeEvent({ kind: 'run:state', runId: 'new', status: 'success' });
    pending.resolve(false); await work;
    expect(adapter.selectProject).not.toHaveBeenCalled();
  });
  it('surfaces a run arriving after select dispatch without claiming safe success', async () => {
    const { adapter, controller } = setup();
    await controller.loadProjects();
    const pending = deferred<{ projectId: string; selectedAt: string }>();
    adapter.selectProject.mockReturnValueOnce(pending.promise);
    const work = controller.selectProject('b');
    await vi.waitFor(() => expect(adapter.selectProject).toHaveBeenCalledTimes(1));
    controller.runtimeEvent({ kind: 'run:state', runId: 'new', status: 'running' });
    pending.resolve({ projectId: 'b', selectedAt: 'now' }); await work;
    expect(controller.getSnapshot().projectsError).toContain('thay đổi');
    expect(controller.getSnapshot().running).toBe(true);
  });
  it('creates an unnamed project once, enforces the title limit and blocks mutations during runs', async () => {
    const { adapter, controller } = setup();
    adapter.healthCheck.mockResolvedValue({ ...healthy, flow: { state: 'READY', projectId: 'c' } });
    adapter.selectProject.mockResolvedValue({ projectId: 'c', selectedAt: 'now' });
    const pending = deferred<{ projectId: string; projectTitle: string }>();
    adapter.createProject.mockReturnValueOnce(pending.promise);
    const work = controller.createProject('  ');
    expect(controller.getSnapshot().selecting).toBe(true);
    await controller.createProject('duplicate');
    expect(adapter.createProject).toHaveBeenCalledTimes(1);
    expect(adapter.createProject).toHaveBeenCalledWith('Dự án chưa đặt tên');
    pending.resolve({ projectId: 'c', projectTitle: '' });
    await work;
    expect(controller.getSnapshot().flow.projectId).toBe('c');
    expect(controller.getSnapshot().selecting).toBe(false);
    await controller.createProject('x'.repeat(101));
    expect(controller.getSnapshot().projectsError).toContain('100');
    controller.runtimeEvent({ kind: 'run:state', runId: 'r', status: 'running' });
    await controller.createProject('blocked');
    await controller.addCustomProject('blocked-id');
    expect(adapter.createProject).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().projects.some(p => p.projectId === 'blocked-id')).toBe(false);
  });
  it('releases all orphan runs when Studio is confirmed closed, allowing project selection', async () => {
    const { adapter, controller } = setup();
    await controller.loadProjects();
    controller.runtimeEvent({ kind: 'run:state', runId: 'one', status: 'running' });
    controller.runtimeEvent({ kind: 'run:state', runId: 'two', status: 'queued' });
    await controller.refresh();
    expect(controller.getSnapshot().running).toBe(false);
    expect(controller.getSnapshot().liveRun).toBeUndefined();
    expect(controller.getSnapshot().logs).toHaveLength(2);
    controller.runtimeEvent({ kind: 'run:state', runId: 'three', status: 'running' });
    controller.runtimeEvent({ kind: 'run:state', runId: 'three', status: 'success' });
    expect(controller.getSnapshot().running).toBe(false);
    adapter.healthCheck.mockResolvedValue({ ...healthy, flow: { state: 'READY', projectId: 'b' } });
    await controller.selectProject('b');
    expect(adapter.selectProject).toHaveBeenCalledWith('b');
  });
  it.each(['open', 'unknown', 'error'])('keeps runs locked when Studio query is %s', async (result) => {
    const { studioOpen, controller } = setup();
    if (result === 'error') studioOpen.mockRejectedValue(new Error('tabs unavailable'));
    else studioOpen.mockResolvedValue(result === 'open' ? true : undefined);
    const message = { kind: 'run:state', runId: 'one', status: 'running' };
    controller.runtimeEvent(message);
    await controller.refresh();
    expect(controller.getSnapshot().running).toBe(true);
    expect(controller.getSnapshot().liveRun).toEqual(message);
  });
  it('does not clear newer runtime events with an older closed-Studio query', async () => {
    const { studioOpen, controller } = setup();
    const pending = deferred<boolean>();
    studioOpen.mockReturnValueOnce(pending.promise);
    const work = controller.refresh();
    controller.runtimeEvent({ kind: 'run:state', runId: 'new', status: 'running' });
    pending.resolve(false);
    await work;
    expect(controller.getSnapshot().running).toBe(true);
    await controller.refresh();
    expect(controller.getSnapshot().running).toBe(false);
  });
  it('releases orphan runs even when Flow health fails, preserving completed live status', async () => {
    const { adapter, controller } = setup();
    controller.runtimeEvent({ kind: 'run:state', runId: 'orphan', status: 'running' });
    controller.runtimeEvent({ kind: 'run:state', runId: 'done', status: 'success' });
    adapter.healthCheck.mockRejectedValueOnce(new Error('offline'));
    await controller.refresh();
    expect(controller.getSnapshot().running).toBe(false);
    expect(controller.getSnapshot().liveRun?.status).toBe('success');
    expect(controller.getSnapshot().flow.state).toBe('ERROR');
  });
  it('single-flights polling; invalidates stale health on pushed Flow changes', async () => {
    const { adapter, controller } = setup();
    const first = deferred<typeof healthy>();
    adapter.healthCheck.mockReturnValueOnce(first.promise);
    const work = controller.refresh();
    void controller.refresh();
    expect(adapter.healthCheck).toHaveBeenCalledTimes(1);
    controller.flowChanged({ state: 'PROJECT_REQUIRED' });
    expect(controller.getSnapshot().flow.state).toBe('PROJECT_REQUIRED');
    adapter.healthCheck.mockResolvedValue({ account: healthy.account, flow: { state: 'PROJECT_REQUIRED' } });
    first.resolve(healthy);
    await work;
    expect(adapter.healthCheck).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().flow.state).toBe('PROJECT_REQUIRED');
  });
  it('clears READY and credits after health rejection; ignores unmounted work', async () => {
    const { adapter, controller } = setup();
    await controller.refresh();
    adapter.healthCheck.mockRejectedValueOnce(new Error('offline'));
    await controller.refresh();
    expect(controller.getSnapshot().flow.state).toBe('ERROR');
    expect(controller.getSnapshot().credits).toEqual({ error: 'offline' });
    const publish = vi.fn();
    controller.subscribe(publish);
    const pending = deferred<typeof healthy>();
    adapter.healthCheck.mockReturnValueOnce(pending.promise);
    const work = controller.refresh();
    controller.dispose();
    publish.mockClear();
    pending.resolve(healthy);
    await work;
    expect(publish).not.toHaveBeenCalled();
  });
  it('handles list loading, failure, retry and empty using adapter schema', async () => {
    const { adapter, controller } = setup();
    adapter.listProjects.mockRejectedValueOnce(new Error('list unavailable'));
    const work = controller.loadProjects();
    expect(controller.getSnapshot().projectsLoading).toBe(true);
    await work;
    expect(controller.getSnapshot().projectsError).toBe('list unavailable');
    adapter.listProjects.mockResolvedValueOnce({ projects: [], source: 'runtime' });
    await controller.loadProjects();
    expect(controller.getSnapshot().projects).toEqual([]);
    expect(controller.getSnapshot().projectsError).toBeUndefined();
    adapter.listProjects.mockResolvedValueOnce({ projects: [], source: 'fallback', error: 'provider unavailable' });
    await controller.loadProjects();
    expect(controller.getSnapshot().projectsError).toBe('provider unavailable');
  });
  it('clears stale credit errors when the next health omits a balance', async () => {
    const { adapter, controller } = setup();
    adapter.healthCheck.mockRejectedValueOnce(new Error('offline'));
    await controller.refresh();
    await controller.refresh();
    expect(controller.getSnapshot().credits).toBeUndefined();
  });
  it('confirms a successful real project selection', async () => {
    const { adapter, controller } = setup();
    await controller.refresh(); await controller.loadProjects();
    adapter.healthCheck.mockResolvedValue({ ...healthy, flow: { state: 'READY', projectId: 'b' } });
    await controller.selectProject('b');
    expect(adapter.selectProject).toHaveBeenCalledWith('b');
    expect(controller.getSnapshot().flow.projectId).toBe('b');
    expect(controller.getSnapshot().projectsError).toBeUndefined();
  });
  it('blocks running but permits selection with an open or unavailable Studio tab query', async () => {
    const { adapter, studioOpen, controller } = setup();
    await controller.refresh(); await controller.loadProjects();
    controller.runtimeEvent({ kind: 'run:state', runId: 'run1', status: 'running' });
    await controller.selectProject('b');
    expect(adapter.selectProject).not.toHaveBeenCalled();
    controller.runtimeEvent({ kind: 'run:state', runId: 'run1', status: 'success' });
    studioOpen.mockResolvedValue(true);
    adapter.healthCheck.mockResolvedValue({ ...healthy, flow: { state: 'READY', projectId: 'b' } });
    await controller.selectProject('b');
    expect(adapter.selectProject).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().projectsError).toBeUndefined();
    studioOpen.mockRejectedValue(new Error('tabs unavailable'));
    await controller.selectProject('b');
    expect(adapter.selectProject).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().projectsError).toBeUndefined();
  });
  it('rechecks running after asynchronous tab guard and rejects unknown project', async () => {
    const { adapter, studioOpen, controller } = setup();
    await controller.refresh(); await controller.loadProjects();
    const pending = deferred<boolean>();
    studioOpen.mockReturnValue(pending.promise);
    const work = controller.selectProject('b');
    controller.runtimeEvent({ kind: 'run:state', runId: 'run1', status: 'validating' });
    pending.resolve(false); await work;
    expect(adapter.selectProject).not.toHaveBeenCalled();
    await controller.selectProject('invented');
    expect(adapter.selectProject).not.toHaveBeenCalled();
  });
  it('single-flights project selection, confirms actual health, surfaces navigation mismatch', async () => {
    const { adapter, controller } = setup();
    await controller.refresh(); await controller.loadProjects();
    await Promise.all([controller.selectProject('b'), controller.selectProject('b')]);
    expect(adapter.selectProject).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().flow.projectId).toBe('a');
    expect(controller.getSnapshot().projectsError).toContain('chưa xác nhận');
  });
  it('bounds logs to 20, preserves errors, tracks all concurrent runs', () => {
    const { controller } = setup();
    controller.runtimeEvent({ kind: 'run:state', runId: 'one', status: 'running' });
    controller.runtimeEvent({ kind: 'run:state', runId: 'two', status: 'running' });
    controller.runtimeEvent({ kind: 'run:state', runId: 'one', status: 'success' });
    expect(controller.getSnapshot().running).toBe(true);
    for (let i = 0; i < 25; i++) controller.runtimeEvent({ kind: 'node:status', runId: 'two', nodeId: String(i), status: 'failed', error: { message: 'actual failure' } });
    expect(controller.getSnapshot().logs).toHaveLength(20);
    expect(controller.getSnapshot().logs[0].text).toContain('actual failure');
    controller.runtimeEvent({ kind: 'run:error', runId: 'two', status: 'failed' });
    expect(controller.getSnapshot().running).toBe(false);
  });
  it('extracts project IDs from Flow URLs or plain UUID strings', () => {
    expect(extractProjectId('https://flow.google.com/project/4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d')).toBe('4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d');
    expect(extractProjectId('4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d')).toBe('4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d');
    expect(extractProjectId('  abc-123  ')).toBe('');
    expect(extractProjectId(' https://labs.google/fx/vi/tools/flow/project/4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d/?x=1#view ')).toBe('4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d');
  });
  it.each([
    'words', 'abc-123', 'https://evil.test/project/ID', 'http://flow.google.com/project/ID',
    'https://flow.google.com.evil.test/project/ID', 'https://flow.google.com@evil.test/project/ID',
    'https://user@flow.google.com/project/ID', 'https://flow.google.com:444/project/ID',
    'https://labs.google/project/ID', 'https://labs.google/fx/tools/other/project/ID',
    'https://flow.google.com/wrong/project/ID', 'https://flow.google.com/project/ID/extra',
    'https://flow.google.com/?next=/project/ID', 'https://flow.google.com/project/not-a-uuid',
  ])('rejects invalid custom input without adapter calls: %s', async input => {
    const { adapter, controller } = setup();
    input = input.replace('ID', '4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d');
    expect(extractProjectId(input)).toBe('');
    await controller.addCustomProject(input);
    expect(adapter.selectProject).not.toHaveBeenCalled();
    expect(controller.getSnapshot().projects).toEqual([]);
    expect(controller.getSnapshot().projectsError).toContain('không hợp lệ');
  });
  it('supports creating a new project and selecting custom projects', async () => {
    const { adapter, controller } = setup();
    adapter.healthCheck.mockResolvedValue({ ...healthy, flow: { state: 'READY', projectId: 'c' } });
    adapter.selectProject.mockResolvedValue({ projectId: 'c', selectedAt: 'now' });
    await controller.createProject('New Project');
    expect(adapter.createProject).toHaveBeenCalledWith('New Project');
    expect(adapter.selectProject).toHaveBeenCalledWith('c');
    expect(controller.getSnapshot().flow.projectId).toBe('c');

    const customId = '4522d4f3-8f5c-49dc-ae2c-82e7cbcb664d';
    adapter.healthCheck.mockResolvedValue({ ...healthy, flow: { state: 'READY', projectId: customId } });
    adapter.selectProject.mockResolvedValue({ projectId: customId, selectedAt: 'now' });
    await controller.addCustomProject(`https://flow.google.com/project/${customId}`);
    expect(adapter.selectProject).toHaveBeenCalledWith(customId);
    expect(controller.getSnapshot().flow.projectId).toBe(customId);
  });
});

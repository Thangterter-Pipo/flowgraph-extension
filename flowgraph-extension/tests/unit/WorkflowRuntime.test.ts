// WorkflowRuntime integration tests (FG-1503) — real executor chain against a MOCK
// adapter: Prompt → T2I → I2V → Download with failure/retry semantics. No provider
// calls, no fake "success" in production code — the mock only exists in tests.
import { describe, expect, it, vi } from 'vitest';
import { WorkflowRuntime, type RuntimeEvent } from '../../src/runtime/WorkflowRuntime';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import type { NodeSpecForValidation } from '../../src/runtime/GraphValidator';

const supported = new Set(['prompt', 't2i', 'i2v', 't2v', 'download']);

function spec(kind: string, id: string, config: Record<string, string> = {}): NodeSpecForValidation {
  const ports = {
    prompt: {
      inputs: [],
      outputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const }],
    },
    t2i: {
      inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const, required: true }],
      outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' as const }],
    },
    i2v: {
      inputs: [{ id: 'image', label: 'Start', type: 'IMAGE' as const, required: true }],
      outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' as const }],
    },
    t2v: {
      inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const, required: true }],
      outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' as const }],
    },
    download: {
      inputs: [{ id: 'media', label: 'Media', type: 'MEDIA' as const, required: true }],
      outputs: [{ id: 'file', label: 'File', type: 'FILE' as const }],
    },
  }[kind] ?? { inputs: [], outputs: [] };
  return { id, kind, inputs: ports.inputs, outputs: ports.outputs, config };
}

const V1_NODES = [
  spec('prompt', '1', { prompt: 'A paper boat on a lake' }),
  spec('t2i', '2', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
  spec('i2v', '3', { model: 'Omni Flash', usageKey: 'abra_i2v_8s' }),
  spec('download', '4', { fileName: 'boat' }),
];
const V1_EDGES = [
  { id: 'e1', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt' },
  { id: 'e2', source: '2', sourceHandle: 'image', target: '3', targetHandle: 'image' },
  { id: 'e3', source: '3', sourceHandle: 'video', target: '4', targetHandle: 'media' },
];

const T2V_NODES = [
  spec('prompt', '1', { prompt: 'A paper boat sailing across a stormy lake' }),
  spec('t2v', '2', {
    model: 'Veo 3.1 - Fast',
    usageKey: 'veo_3_1_t2v_fast',
    aspectRatio: '16:9 (Landscape)',
    duration: '8 seconds',
    resolution: '720p',
  }),
  spec('download', '3', { fileName: 't2v-boat' }),
];
const T2V_EDGES = [
  { id: 'e1', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt' },
  { id: 'e2', source: '2', sourceHandle: 'video', target: '3', targetHandle: 'media' },
];

const PROJECT = { projectId: 'p-1', projectName: 'Test Project', selectedAt: new Date().toISOString() };
const ACCOUNT = { state: 'CONNECTED' as const, email: 't@example.com' };
const FLOW = { state: 'READY' as const, projectId: 'p-1' };

function mockAdapter(overrides: Partial<GoogleFlowAdapter> = {}): GoogleFlowAdapter {
  return {
    healthCheck: vi.fn(async () => ({ account: ACCOUNT, flow: FLOW })),
    listProjects: vi.fn(async (): Promise<{ projects: never[]; source: 'runtime' }> => ({ projects: [], source: 'runtime' })),
    createProject: vi.fn(async (title: string) => ({ projectId: 'new-1', projectTitle: title })),
    selectProject: vi.fn(async (projectId: string) => ({ projectId, selectedAt: new Date().toISOString() })),
    uploadImage: vi.fn(),
    generate: vi.fn(async (payload) => ({
      mediaId: payload.kind === 't2i' ? 'img-1' : `vid-${payload.kind}`,
      type: payload.kind === 't2i' ? 'IMAGE' as const : 'VIDEO' as const,
      projectId: payload.projectId,
      previewUrl: payload.kind === 't2i' ? 'https://cdn.example/img-1' : undefined,
    })),
    waitForMedia: vi.fn(async () => ({ status: 'SUCCESSFUL' as const, media: { mediaId: 'vid-i2v', type: 'VIDEO' as const, projectId: 'p-1', previewUrl: 'https://cdn.example/vid-i2v' } })),
    resolvePreviewUrl: vi.fn(async () => undefined),
    downloadMedia: vi.fn(async () => ({ ok: true, downloadId: 42, filename: 'C:/Downloads/boat.mp4' })),
    cancel: vi.fn(async () => ({})),
    ...overrides,
  };
}

function collect() {
  const events: RuntimeEvent[] = [];
  const emit = (event: RuntimeEvent) => events.push(event);
  return { events, emit };
}

describe('WorkflowRuntime', () => {
  it('runs the full V1 chain in dependency order', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();

    await runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);

    const successOrder = events
      .filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && event.state === 'success')
      .map((event) => event.nodeId);
    expect(successOrder).toEqual(['1', '2', '3', '4']);
    expect(events.some((event) => event.type === 'run' && event.state === 'success')).toBe(true);
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 't2i', projectId: 'p-1' }));
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'i2v', startImage: { mediaId: 'img-1' } }));
    expect(adapter.downloadMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 'vid-i2v' }));
  });

  it('runs the Text-to-Video chain (Prompt → T2V → Download) in dependency order', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();

    await runtime.run(T2V_NODES, T2V_EDGES, { workflowId: 'wf-t2v', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);

    const successOrder = events
      .filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && event.state === 'success')
      .map((event) => event.nodeId);
    expect(successOrder).toEqual(['1', '2', '3']);
    expect(events.some((event) => event.type === 'run' && event.state === 'success')).toBe(true);
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 't2v', projectId: 'p-1' }));
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'A paper boat sailing across a stormy lake' }));
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({
      modelLabel: 'Veo 3.1 - Fast',
      aspectRatio: '16:9 (Landscape)',
      durationSeconds: 8,
      targetResolution: '720p',
    }));
    // waitForMedia must poll the media id returned by generate.
    expect(adapter.waitForMedia).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p-1', mediaId: 'vid-t2v' }));
    // Download must consume the media id from the executor's output MediaRef.
    expect(adapter.downloadMedia).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 'vid-t2v' }));
  });

  it('marks downstream nodes skipped when mid-chain fails', async () => {
    const adapter = mockAdapter({
      generate: vi.fn(async (payload) => {
        if (payload.kind === 't2i') throw new Error('T2I failed');
        return { mediaId: 'vid-1', type: 'VIDEO' as const, projectId: 'p-1' };
      }),
    });
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();

    await expect(runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit))
      .rejects.toBeTruthy();

    const states = Object.fromEntries(
      events.filter((event) => event.type === 'node').map((event) => [event.nodeId, event.state]),
    );
    expect(states['1']).toBe('success');
    expect(states['2']).toBe('failed');
    expect(states['3']).toBe('skipped');
    expect(states['4']).toBe('skipped');
    expect(events.some((event) => event.type === 'run' && event.state === 'failed')).toBe(true);
  });

  it('blocks before any adapter call when the graph is invalid', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();

    const missingInput = [V1_NODES[1]]; // t2i with no prompt connected
    await expect(runtime.run(missingInput, [], { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'run' && event.state === 'failed')).toBe(true);
  });

  it('rejects unsupported node kinds at validation', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const report = runtime.validate([spec('extend', '9', {})], [], PROJECT);
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'UNSUPPORTED_NODE')).toBe(true);
  });

  it('replays cache hits without calling the provider (CACHE HIT, FG-0902)', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();
    // First run populates the cache.
    await runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);
    expect(adapter.generate).toHaveBeenCalledTimes(2);

    // Second run should hit cache for the generation nodes.
    (adapter.generate as ReturnType<typeof vi.fn>).mockClear();
    (adapter.downloadMedia as ReturnType<typeof vi.fn>).mockClear();
    const second = collect();
    await runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, second.emit);
    const cacheHits = second.events.filter((event) => event.type === 'node' && event.cacheHit);
    expect(cacheHits.length).toBeGreaterThanOrEqual(1);
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it('retryNode reruns only the failed node and resumes downstream (FG-0804)', async () => {
    let failOnce = true;
    const adapter = mockAdapter({
      generate: vi.fn(async (payload) => {
        if (payload.kind === 't2i' && failOnce) {
          failOnce = false;
          throw new Error('transient');
        }
        return { mediaId: payload.kind === 't2i' ? 'img-1' : 'vid-r', type: payload.kind === 't2i' ? 'IMAGE' as const : 'VIDEO' as const, projectId: 'p-1' };
      }),
    });
    const runtime = new WorkflowRuntime(adapter);
    const first = collect();
    await expect(runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, first.emit)).rejects.toBeTruthy();
    const failedEvents = first.events
      .filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && event.state === 'failed');
    expect(failedEvents.some((event) => event.nodeId === '2')).toBe(true);

    // Retry node 2 (the failed t2i) and resume.
    const retry = collect();
    await expect(runtime.retryNode('2', V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, retry.emit)).resolves.toBeUndefined();
    // Node 2 succeeds on retry, node 3 reruns downstream, node 4 downloads.
    const retrySuccesses = retry.events
      .filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && event.state === 'success')
      .map((event) => event.nodeId)
      .sort();
    expect(retrySuccesses).toEqual(['2', '3', '4']);
  });

  it('runs independent branches concurrently within the configured limit (FG-1002/FG-1503)', async () => {
    let active = 0;
    let maxActive = 0;
    let mediaCounter = 0;
    const adapter = mockAdapter({
      generate: vi.fn(async (payload) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 80));
        active -= 1;
        mediaCounter += 1;
        return { mediaId: `img-parallel-${mediaCounter}`, type: 'IMAGE' as const, projectId: payload.projectId };
      }),
    });
    const runtime = new WorkflowRuntime(adapter);
    const nodes = [
      spec('prompt', 'p1', { prompt: 'Branch one' }),
      spec('t2i', 'i1', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
      spec('prompt', 'p2', { prompt: 'Branch two' }),
      spec('t2i', 'i2', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
    ];
    const edges = [
      { id: 'a', source: 'p1', sourceHandle: 'prompt', target: 'i1', targetHandle: 'prompt' },
      { id: 'b', source: 'p2', sourceHandle: 'prompt', target: 'i2', targetHandle: 'prompt' },
    ];
    const { events, emit } = collect();

    await runtime.run(nodes, edges, { workflowId: 'wf-parallel', activeProject: PROJECT, account: ACCOUNT, flow: FLOW, concurrency: 2 }, emit);

    expect(maxActive).toBe(2);
    expect(events.filter((event) => event.type === 'node' && event.state === 'success')).toHaveLength(4);
    expect(events.some((event) => event.type === 'run' && event.state === 'success')).toBe(true);
  });

  it('cancel aborts the run and marks it cancelled (FG-0806)', async () => {
    let first: Promise<void> | null = null;
    const adapter = mockAdapter({
      generate: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { mediaId: 'img-slow', type: 'IMAGE' as const, projectId: 'p-1' };
      }),
    });
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();
    first = runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await runtime.cancel();
    await expect(first).rejects.toBeTruthy();
    expect(events.some((event) => event.type === 'run' && event.state === 'cancelled')).toBe(true);
  });
});

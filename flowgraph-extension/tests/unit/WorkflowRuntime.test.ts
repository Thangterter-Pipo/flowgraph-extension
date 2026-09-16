// WorkflowRuntime integration tests (FG-1503) — real executor chain against a MOCK
// adapter: Prompt → T2I → I2V → Download with failure/retry semantics. No provider
// calls, no fake "success" in production code — the mock only exists in tests.
import { describe, expect, it, vi } from 'vitest';
import { WorkflowRuntime, type RuntimeEvent } from '../../src/runtime/WorkflowRuntime';
import { executionStage, selectReadyStage } from '../../src/runtime/executionPolicy';
import { buildRunModePlan, createRunReceipt } from '../../src/ui/studio/workflowRunMode';
import { node as canvasNode } from '../../src/ui/studio/model';
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
      inputs: [
        { id: 'image', label: 'Start', type: 'IMAGE' as const, required: true },
        { id: 'prompt', label: 'Prompt', type: 'PROMPT' as const },
      ],
      outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' as const }],
    },
    t2v: {
      inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const, required: true }],
      outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' as const }],
    },
    preview: {
      inputs: [{ id: 'media', label: 'Media', type: 'MEDIA' as const, required: true }],
      outputs: [{ id: 'media', label: 'Media', type: 'MEDIA' as const }],
    },
    download: {
      inputs: [{ id: 'media', label: 'Media', type: 'MEDIA' as const, required: true }],
      outputs: [{ id: 'file', label: 'File', type: 'FILE' as const }],
    },
    imageInput: {
      inputs: [],
      outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' as const }],
    },
    imageUpscale: {
      inputs: [{ id: 'image', label: 'Image', type: 'IMAGE' as const, required: true }],
      outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' as const }],
    },
  }[kind] ?? { inputs: [], outputs: [] };
  return { id, kind, inputs: ports.inputs, outputs: ports.outputs, config };
}

const V1_NODES = [
  spec('prompt', '1', { prompt: 'A paper boat on a lake' }),
  spec('t2i', '2', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
  spec('i2v', '3', { model: 'Omni Flash', usageKey: 'abra_i2v_8s' }),
  spec('download', '4', { fileName: 'boat', autoDownload: 'true' }),
];
const V1_EDGES = [
  { id: 'e1', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt' },
  { id: 'e2', source: '2', sourceHandle: 'image', target: '3', targetHandle: 'image' },
  { id: 'e3', source: '3', sourceHandle: 'video', target: '4', targetHandle: 'media' },
  // Mirrors the real V1 graph: the I2V node's prompt must be wired too. Live run
  // a82e1b01 failed because this edge was missing and the service worker then
  // invented a placeholder prompt.
  { id: 'e4', source: '1', sourceHandle: 'prompt', target: '3', targetHandle: 'prompt' },
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
  spec('download', '3', { fileName: 't2v-boat', autoDownload: 'true' }),
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

/** Group consecutive `queued` events emitted before a batch starts running. */
function queuedBatches(events: RuntimeEvent[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  for (const event of events) {
    if (event.type !== 'node') continue;
    if (event.state === 'queued') {
      current.push(event.nodeId);
      continue;
    }
    if (current.length) {
      batches.push(current);
      current = [];
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

describe('WorkflowRuntime', () => {
  it('continues a partial run across persistence and restarts without reusing generated outputs', async () => {
    let fail = true;
    const adapter = mockAdapter({ downloadMedia: vi.fn(async () => ({ ok: !fail })) });
    const runtime = new WorkflowRuntime(adapter);
    let nodes = V1_NODES.map((n) => canvasNode(n.id, n.kind, 0, 0, { config: n.config }));
    const options = { workflowId: 'modes', activeProject: PROJECT, account: ACCOUNT, flow: FLOW };
    const execute = async (mode: 'continue' | 'restart') => {
      const plan = buildRunModePlan(mode, nodes, V1_EDGES, PROJECT.projectId);
      if (!plan.run.length) return plan;
      await runtime.run(V1_NODES, V1_EDGES, { ...options, ...plan }, (event) => {
        if (event.type !== 'node') return;
        const n = nodes.find((candidate) => candidate.id === event.nodeId)!;
        n.data.status = event.state;
        if (event.state === 'success' && event.outputs) n.data.runReceipt = createRunReceipt(plan.signatures.get(n.id)!, event.outputs);
      });
      return plan;
    };
    await expect(execute('continue')).rejects.toThrow();
    expect(adapter.generate).toHaveBeenCalledTimes(2);
    nodes = JSON.parse(JSON.stringify(nodes));
    fail = false;
    expect((await execute('continue')).run).toEqual(['4']);
    expect(adapter.generate).toHaveBeenCalledTimes(2);
    expect((await execute('continue')).run).toEqual([]);
    expect(adapter.downloadMedia).toHaveBeenCalledTimes(2);
    const before = nodes.map((n) => ({ id: n.id, config: n.data.config, position: n.position }));
    await execute('restart');
    expect(adapter.generate).toHaveBeenCalledTimes(4);
    expect(adapter.downloadMedia).toHaveBeenCalledTimes(3);
    expect(nodes.map((n) => ({ id: n.id, config: n.data.config, position: n.position }))).toEqual(before);
  });
  it('exports exact successful outputs and bypasses only selected cache nodes', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const options = { workflowId: 'modes', activeProject: PROJECT, account: ACCOUNT, flow: FLOW };
    await runtime.run(V1_NODES, V1_EDGES, options, () => {});
    const { events, emit } = collect();
    await runtime.run(V1_NODES, V1_EDGES, { ...options, bypassCacheNodeIds: new Set(['3']) }, emit);
    expect(adapter.generate).toHaveBeenCalledTimes(3);
    const image = events.find((e) => e.type === 'node' && e.nodeId === '2' && e.state === 'success');
    expect(image).toMatchObject({ cacheHit: true, outputs: { image: { type: 'image' } } });
    const video = events.find((e) => e.type === 'node' && e.nodeId === '3' && e.state === 'success');
    expect(video).toMatchObject({ outputs: { video: { type: 'video' } } });
  });
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
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 't2i', projectId: 'p-1' }), expect.anything());
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'i2v', startImage: { mediaId: 'img-1' } }), expect.anything());
    // The node prompt must reach the adapter: an empty prompt used to be silently
    // replaced by a hard-coded placeholder inside the service worker.
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'i2v', prompt: 'A paper boat on a lake' }), expect.anything());
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
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 't2v', projectId: 'p-1' }), expect.anything());
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'A paper boat sailing across a stormy lake' }), expect.anything());
    expect(adapter.generate).toHaveBeenCalledWith(expect.objectContaining({
      modelLabel: 'Veo 3.1 - Fast',
      aspectRatio: '16:9 (Landscape)',
      durationSeconds: 8,
      targetResolution: '720p',
    }), expect.anything());
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
    const report = runtime.validate([spec('upscale', '9', {})], [], PROJECT);
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
    const cacheHits = second.events.filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && Boolean(event.cacheHit));
    expect(cacheHits.length).toBeGreaterThanOrEqual(1);
    expect(cacheHits.some((event) => event.nodeId === '2' || event.nodeId === '3')).toBe(true);
    expect(cacheHits.some((event) => event.nodeId === '4')).toBe(false);
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(adapter.downloadMedia).toHaveBeenCalledTimes(1);
  });

  it('does not cache Preview/Download sinks; generation still cache-hits', async () => {
    const adapter = mockAdapter({
      resolvePreviewUrl: vi.fn(async () => 'https://cdn.example/fresh-preview'),
    });
    const runtime = new WorkflowRuntime(adapter);
    const nodes = [
      spec('prompt', '1', { prompt: 'A paper boat on a lake' }),
      spec('t2i', '2', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
      spec('preview', 'prev'),
      spec('download', 'dl', { fileName: 'boat', autoDownload: 'true' }),
    ];
    const edges = [
      { id: 'e1', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt' },
      { id: 'e2', source: '2', sourceHandle: 'image', target: 'prev', targetHandle: 'media' },
      { id: 'e3', source: 'prev', sourceHandle: 'media', target: 'dl', targetHandle: 'media' },
    ];
    await runtime.run(nodes, edges, { workflowId: 'wf-sinks', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, collect().emit);
    (adapter.generate as ReturnType<typeof vi.fn>).mockClear();
    (adapter.downloadMedia as ReturnType<typeof vi.fn>).mockClear();
    (adapter.resolvePreviewUrl as ReturnType<typeof vi.fn>).mockClear();

    const second = collect();
    await runtime.run(nodes, edges, { workflowId: 'wf-sinks', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, second.emit);

    expect(adapter.generate).not.toHaveBeenCalled();
    expect(adapter.downloadMedia).toHaveBeenCalledTimes(1);
    expect(adapter.resolvePreviewUrl).toHaveBeenCalled();
    const cacheHits = second.events.filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && Boolean(event.cacheHit));
    expect(cacheHits.some((event) => event.nodeId === '2')).toBe(true);
    expect(cacheHits.some((event) => event.nodeId === 'prev' || event.nodeId === 'dl')).toBe(false);
    const previewSuccess = second.events.find((event) => event.type === 'node' && event.nodeId === 'prev' && event.state === 'success');
    expect(previewSuccess && previewSuccess.type === 'node' ? previewSuccess.cacheHit : true).toBeFalsy();
    expect(previewSuccess && previewSuccess.type === 'node' ? previewSuccess.result?.previewUrl : '').toBe('https://cdn.example/fresh-preview');
  });

  it('does not cache-collide T2I nodes fed by different connected prompts', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const nodes = [
      spec('prompt', 'p-start', { prompt: 'Wide samurai in a bamboo forest' }),
      spec('prompt', 'p-end', { prompt: 'Close-up samurai drawing a katana' }),
      spec('t2i', 'img-start', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
      spec('t2i', 'img-end', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
    ];
    const edges = [
      { id: 'e-start', source: 'p-start', sourceHandle: 'prompt', target: 'img-start', targetHandle: 'prompt' },
      { id: 'e-end', source: 'p-end', sourceHandle: 'prompt', target: 'img-end', targetHandle: 'prompt' },
    ];

    const run = collect();
    await runtime.run(nodes, edges, { workflowId: 'wf-two-prompts', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, run.emit);

    expect(adapter.generate).toHaveBeenCalledTimes(2);
    const generatedPrompts = (adapter.generate as ReturnType<typeof vi.fn>).mock.calls.map(([payload]) => payload.prompt);
    expect(generatedPrompts).toContain('Wide samurai in a bamboo forest');
    expect(generatedPrompts).toContain('Close-up samurai drawing a katana');
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

  it('retryNode rejects before provider work when topology changed after failure', async () => {
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
    await expect(runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, collect().emit)).rejects.toBeTruthy();
    (adapter.generate as ReturnType<typeof vi.fn>).mockClear();
    const rewired = V1_EDGES.filter((edge) => edge.id !== 'e4');
    await expect(runtime.retryNode('2', V1_NODES, rewired, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, collect().emit))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it('retryNode rejects before provider work when generation config changed after failure', async () => {
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
    await expect(runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, collect().emit)).rejects.toBeTruthy();
    (adapter.generate as ReturnType<typeof vi.fn>).mockClear();
    const changed = V1_NODES.map((node) => node.id === '2'
      ? spec('t2i', '2', { model: 'Nano Banana Pro', usageKey: 'GEM_PIX_2' })
      : node);
    await expect(runtime.retryNode('2', changed, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, collect().emit))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it('retryFailed rejects a stale graph and does not call the provider', async () => {
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
    await expect(runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, collect().emit)).rejects.toBeTruthy();
    (adapter.generate as ReturnType<typeof vi.fn>).mockClear();
    const rewired = V1_EDGES.filter((edge) => edge.id !== 'e4');
    await expect(runtime.retryFailed(V1_NODES, rewired, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, collect().emit))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(adapter.generate).not.toHaveBeenCalled();
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

    expect(maxActive).toBeLessThanOrEqual(1);
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

  it('stages independent T2I in one batch, delays video, runs Prompt immediately, Preview/Download last', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const nodes = [
      spec('prompt', 'p1', { prompt: 'Start frame' }),
      spec('prompt', 'p2', { prompt: 'End frame' }),
      spec('prompt', 'p3', { prompt: 'Video motion' }),
      spec('t2i', 'img1', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
      spec('t2i', 'img2', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
      spec('t2v', 'vid', { model: 'Veo 3.1 - Fast', usageKey: 'veo_3_1_t2v_fast' }),
      spec('preview', 'prev'),
      spec('download', 'dl', { fileName: 'out', autoDownload: 'true' }),
      spec('download', 'dl-img', { fileName: 'frame', autoDownload: 'true' }),
    ];
    const edges = [
      { id: 'a', source: 'p1', sourceHandle: 'prompt', target: 'img1', targetHandle: 'prompt' },
      { id: 'b', source: 'p2', sourceHandle: 'prompt', target: 'img2', targetHandle: 'prompt' },
      { id: 'c', source: 'p3', sourceHandle: 'prompt', target: 'vid', targetHandle: 'prompt' },
      { id: 'd', source: 'img1', sourceHandle: 'image', target: 'prev', targetHandle: 'media' },
      { id: 'e', source: 'vid', sourceHandle: 'video', target: 'dl', targetHandle: 'media' },
      { id: 'f', source: 'img2', sourceHandle: 'image', target: 'dl-img', targetHandle: 'media' },
    ];
    const { events, emit } = collect();
    await runtime.run(nodes, edges, { workflowId: 'wf-stage', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);

    const successOrder = events
      .filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && event.state === 'success')
      .map((event) => event.nodeId);
    const idx = (id: string) => successOrder.indexOf(id);
    const batches = queuedBatches(events);
    const imageBatch = batches.find((batch) => batch.includes('img1') && batch.includes('img2'));

    expect(imageBatch).toBeDefined();
    expect(imageBatch).not.toContain('vid');
    expect(imageBatch).not.toContain('prev');
    expect(imageBatch).not.toContain('dl');
    expect(idx('p1')).toBeGreaterThanOrEqual(0);
    expect(idx('p3')).toBeLessThan(idx('img1'));
    expect(idx('p3')).toBeLessThan(idx('vid'));
    expect(Math.max(idx('img1'), idx('img2'))).toBeLessThan(idx('vid'));
    expect(idx('vid')).toBeLessThan(idx('prev'));
    expect(idx('vid')).toBeLessThan(idx('dl'));
    expect(idx('vid')).toBeLessThan(idx('dl-img'));
    expect(events.some((event) => event.type === 'run' && event.state === 'success')).toBe(true);
  });

  it('cancel during pending generate stops the run without waiting or caching success', async () => {
    let generateStarted = 0;
    const adapter = mockAdapter({
      generate: vi.fn(async () => {
        generateStarted += 1;
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return { mediaId: 'img-late', type: 'IMAGE' as const, projectId: 'p-1', previewUrl: 'https://cdn.example/late' };
      }),
      cancel: vi.fn(async () => ({})),
    });
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();
    const started = Date.now();
    const run = runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(generateStarted).toBe(1);
    await runtime.cancel();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(events.some((event) => event.type === 'run' && event.state === 'cancelled')).toBe(true);
    const generationSuccess = events.some((event) =>
      event.type === 'node' && event.state === 'success' && event.nodeId !== '1',
    );
    expect(generationSuccess).toBe(false);
    expect(events.some((event) => event.type === 'node' && event.cacheHit)).toBe(false);
    const cancelCalls = (adapter.cancel as ReturnType<typeof vi.fn>).mock.calls;
    for (const [payload] of cancelCalls) {
      expect(payload.mediaId).not.toBe('1');
      expect(payload.mediaId).not.toBe('2');
      expect(payload.mediaId).toEqual(expect.any(String));
      expect(String(payload.mediaId).length).toBeGreaterThan(2);
    }
  });

  it('cancel during pending generate with a known mediaId calls provider cancel only with that id', async () => {
    let generateStarted = 0;
    const adapter = mockAdapter({
      generate: vi.fn(async (payload, opts) => {
        generateStarted += 1;
        const onMediaId = opts && typeof opts === 'object' && !(opts instanceof AbortSignal)
          ? (opts as { onMediaId?: (id: string) => void }).onMediaId
          : undefined;
        onMediaId?.('media-provider-9f3a');
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return { mediaId: 'media-provider-9f3a', type: 'VIDEO' as const, projectId: payload.projectId };
      }),
      cancel: vi.fn(async () => ({})),
    });
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();
    const started = Date.now();
    const run = runtime.run(T2V_NODES, T2V_EDGES, { workflowId: 'wf-t2v', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(generateStarted).toBe(1);
    await runtime.cancel();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(events.some((event) => event.type === 'run' && event.state === 'cancelled')).toBe(true);
    expect(events.some((event) => event.type === 'node' && event.nodeId === '2' && event.state === 'success')).toBe(false);
    expect(events.some((event) => event.type === 'node' && event.cacheHit)).toBe(false);
    expect(adapter.cancel).toHaveBeenCalledWith({ projectId: 'p-1', mediaId: 'media-provider-9f3a' });
    const cancelCalls = (adapter.cancel as ReturnType<typeof vi.fn>).mock.calls;
    expect(cancelCalls.length).toBeGreaterThan(0);
    for (const [payload] of cancelCalls) {
      expect(payload.mediaId).toBe('media-provider-9f3a');
      expect(payload.mediaId).not.toBe('1');
      expect(payload.mediaId).not.toBe('2');
    }
  });

  it('cancel during pending T2I generate with a known mediaId calls provider cancel only with that id', async () => {
    let generateStarted = 0;
    const adapter = mockAdapter({
      generate: vi.fn(async (payload, opts) => {
        generateStarted += 1;
        const onMediaId = opts && typeof opts === 'object' && !(opts instanceof AbortSignal)
          ? (opts as { onMediaId?: (id: string) => void }).onMediaId
          : undefined;
        onMediaId?.('t2i-provider-media-42');
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return { mediaId: 't2i-provider-media-42', type: 'IMAGE' as const, projectId: payload.projectId, previewUrl: 'https://cdn.example/late' };
      }),
      cancel: vi.fn(async () => ({})),
    });
    const runtime = new WorkflowRuntime(adapter);
    const { events, emit } = collect();
    const started = Date.now();
    const run = runtime.run(V1_NODES, V1_EDGES, { workflowId: 'wf-1', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(generateStarted).toBe(1);
    await runtime.cancel();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(events.some((event) => event.type === 'run' && event.state === 'cancelled')).toBe(true);
    expect(events.some((event) => event.type === 'node' && event.nodeId === '2' && event.state === 'success')).toBe(false);
    expect(events.some((event) => event.type === 'node' && event.cacheHit)).toBe(false);
    expect(adapter.cancel).toHaveBeenCalledWith({ projectId: 'p-1', mediaId: 't2i-provider-media-42' });
    const cancelCalls = (adapter.cancel as ReturnType<typeof vi.fn>).mock.calls;
    expect(cancelCalls.length).toBeGreaterThan(0);
    for (const [payload] of cancelCalls) {
      expect(payload.mediaId).toBe('t2i-provider-media-42');
      expect(payload.mediaId).not.toBe('1');
      expect(payload.mediaId).not.toBe('2');
    }
  });

  it('cancel during pending ImageUpscale generate does not cache success and cancels only a real mediaId', async () => {
    let generateStarted = 0;
    const adapter = mockAdapter({
      generate: vi.fn(async (payload, opts) => {
        generateStarted += 1;
        const onMediaId = opts && typeof opts === 'object' && !(opts instanceof AbortSignal)
          ? (opts as { onMediaId?: (id: string) => void }).onMediaId
          : undefined;
        onMediaId?.('upscale-provider-media-7');
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return { mediaId: 'upscale-provider-media-7', type: 'IMAGE' as const, projectId: payload.projectId };
      }),
      cancel: vi.fn(async () => ({})),
    });
    const runtime = new WorkflowRuntime(adapter);
    const nodes = [
      spec('imageInput', '1', { mediaId: 'img-12345', mediaType: 'IMAGE', projectId: 'p-1', type: 'IMAGE' }),
      spec('imageUpscale', '2', { targetResolution: '2K' }),
    ];
    const edges = [
      { id: 'e1', source: '1', sourceHandle: 'image', target: '2', targetHandle: 'image' },
    ];
    const { events, emit } = collect();
    const started = Date.now();
    const run = runtime.run(nodes, edges, { workflowId: 'wf-upscale', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(generateStarted).toBe(1);
    await runtime.cancel();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(events.some((event) => event.type === 'run' && event.state === 'cancelled')).toBe(true);
    expect(events.some((event) => event.type === 'node' && event.nodeId === '2' && event.state === 'success')).toBe(false);
    expect(events.some((event) => event.type === 'node' && event.cacheHit)).toBe(false);
    expect(adapter.cancel).toHaveBeenCalledWith({ projectId: 'p-1', mediaId: 'upscale-provider-media-7' });
    const cancelCalls = (adapter.cancel as ReturnType<typeof vi.fn>).mock.calls;
    expect(cancelCalls.length).toBeGreaterThan(0);
    for (const [payload] of cancelCalls) {
      expect(payload.mediaId).toBe('upscale-provider-media-7');
      expect(payload.mediaId).not.toBe('1');
      expect(payload.mediaId).not.toBe('2');
      expect(payload.mediaId).not.toBe('img-12345');
    }
  });

  it('cancel during pending ImageUpscale without a reported mediaId does not call provider cancel', async () => {
    let generateStarted = 0;
    const adapter = mockAdapter({
      generate: vi.fn(async () => {
        generateStarted += 1;
        await new Promise((resolve) => setTimeout(resolve, 4000));
        return { mediaId: 'upscale-late', type: 'IMAGE' as const, projectId: 'p-1' };
      }),
      cancel: vi.fn(async () => ({})),
    });
    const runtime = new WorkflowRuntime(adapter);
    const nodes = [
      spec('imageInput', '1', { mediaId: 'img-12345', mediaType: 'IMAGE', projectId: 'p-1', type: 'IMAGE' }),
      spec('imageUpscale', '2', { targetResolution: '2K' }),
    ];
    const edges = [
      { id: 'e1', source: '1', sourceHandle: 'image', target: '2', targetHandle: 'image' },
    ];
    const { events, emit } = collect();
    const run = runtime.run(nodes, edges, { workflowId: 'wf-upscale-nomedia', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(generateStarted).toBe(1);
    await runtime.cancel();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(events.some((event) => event.type === 'node' && event.nodeId === '2' && event.state === 'success')).toBe(false);
    expect(events.some((event) => event.type === 'node' && event.cacheHit)).toBe(false);
    expect(adapter.cancel).not.toHaveBeenCalled();
  });

  it('does not generate stray branches when a download sink exists', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const nodes = [
      spec('prompt', 'p-out', { prompt: 'Keep' }),
      spec('t2i', 'img-out', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
      spec('download', 'dl', { fileName: 'keep', autoDownload: 'true' }),
      spec('prompt', 'p-stray', { prompt: 'Stray video' }),
      spec('t2v', 'vid-stray', { model: 'Veo 3.1 - Fast', usageKey: 'veo_3_1_t2v_fast' }),
    ];
    const edges = [
      { id: 'a', source: 'p-out', sourceHandle: 'prompt', target: 'img-out', targetHandle: 'prompt' },
      { id: 'b', source: 'img-out', sourceHandle: 'image', target: 'dl', targetHandle: 'media' },
      { id: 'c', source: 'p-stray', sourceHandle: 'prompt', target: 'vid-stray', targetHandle: 'prompt' },
    ];
    const { events, emit } = collect();
    await runtime.run(nodes, edges, { workflowId: 'wf-orphan', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);

    const kinds = (adapter.generate as ReturnType<typeof vi.fn>).mock.calls.map(([payload]) => payload.kind);
    expect(kinds).toEqual(['t2i']);
    expect(events.some((event) => event.type === 'node' && event.nodeId === 'vid-stray' && event.state === 'skipped')).toBe(true);
    expect(events.some((event) => event.type === 'node' && event.nodeId === 'vid-stray' && event.state === 'success')).toBe(false);
    expect(events.some((event) => event.type === 'run' && event.state === 'success')).toBe(true);
  });

  it('runs the union of ancestors when multiple sinks exist', async () => {
    const adapter = mockAdapter();
    const runtime = new WorkflowRuntime(adapter);
    const nodes = [
      spec('prompt', 'p1', { prompt: 'A' }),
      spec('t2i', 'img1', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
      spec('preview', 'prev'),
      spec('prompt', 'p2', { prompt: 'B' }),
      spec('t2i', 'img2', { model: 'Nano Banana 2', usageKey: 'NARWHAL' }),
      spec('download', 'dl', { fileName: 'b', autoDownload: 'true' }),
    ];
    const edges = [
      { id: 'a', source: 'p1', sourceHandle: 'prompt', target: 'img1', targetHandle: 'prompt' },
      { id: 'b', source: 'img1', sourceHandle: 'image', target: 'prev', targetHandle: 'media' },
      { id: 'c', source: 'p2', sourceHandle: 'prompt', target: 'img2', targetHandle: 'prompt' },
      { id: 'd', source: 'img2', sourceHandle: 'image', target: 'dl', targetHandle: 'media' },
    ];
    const { events, emit } = collect();
    await runtime.run(nodes, edges, { workflowId: 'wf-sinks', activeProject: PROJECT, account: ACCOUNT, flow: FLOW }, emit);
    const kinds = (adapter.generate as ReturnType<typeof vi.fn>).mock.calls.map(([payload]) => payload.kind);
    expect(kinds.sort()).toEqual(['t2i', 't2i']);
    expect(events
      .filter((event): event is Extract<RuntimeEvent, { type: 'node' }> => event.type === 'node' && event.state === 'success')
      .map((event) => event.nodeId)
      .sort())
      .toEqual(['dl', 'img1', 'img2', 'p1', 'p2', 'prev']);
  });
});

describe('execution stage policy', () => {
  const byId = new Map([
    ['p', { id: 'p', kind: 'prompt' }],
    ['g', { id: 'g', kind: 'gemini' }],
    ['i1', { id: 'i1', kind: 't2i' }],
    ['i2', { id: 'i2', kind: 't2i' }],
    ['v', { id: 'v', kind: 't2v' }],
    ['i2v', { id: 'i2v', kind: 'i2v' }],
    ['prev', { id: 'prev', kind: 'preview' }],
    ['dl', { id: 'dl', kind: 'download' }],
  ]);

  it('keeps two ready T2I nodes in the same stage batch', () => {
    expect(selectReadyStage(['i1', 'i2'], byId).sort()).toEqual(['i1', 'i2']);
  });

  it('does not start video while an image node is ready', () => {
    expect(selectReadyStage(['i1', 'v', 'i2v'], byId).sort()).toEqual(['i1']);
  });

  it('does not block Prompt behind video or image stages', () => {
    expect(selectReadyStage(['p', 'v', 'i1'], byId)).toEqual(['p']);
    expect(executionStage('prompt')).toBeLessThan(executionStage('t2i'));
    expect(executionStage('prompt')).toBeLessThan(executionStage('t2v'));
  });

  it('runs Preview and Download only after video/image stages', () => {
    expect(selectReadyStage(['v', 'dl', 'prev'], byId)).toEqual(['v']);
    expect(selectReadyStage(['dl', 'prev'], byId).sort()).toEqual(['dl', 'prev']);
    expect(executionStage('download')).toBeGreaterThan(executionStage('t2v'));
    expect(executionStage('preview')).toBeGreaterThan(executionStage('t2i'));
  });
});

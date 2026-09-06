import { describe, it, expect, vi } from 'vitest';
import {
  WorkflowRuntime,
  VERIFIED_GOOGLE_FLOW_CONCURRENCY_LIMIT,
  resolveEffectiveConcurrency,
  RuntimeEvent,
} from '../../src/runtime/WorkflowRuntime';
import { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import type { NodeSpecForValidation } from '../../src/runtime/GraphValidator';

describe('FG-1001 — Provider-specific Concurrency Limit', () => {
  it('enforces verified Google Flow provider cap correctly via resolveEffectiveConcurrency', () => {
    // 1. When undefined or null -> default 2
    expect(resolveEffectiveConcurrency(undefined)).toBe(2);
    expect(resolveEffectiveConcurrency(undefined)).toBeLessThanOrEqual(VERIFIED_GOOGLE_FLOW_CONCURRENCY_LIMIT);

    // 2. When requested 1 -> effective 1
    expect(resolveEffectiveConcurrency(1)).toBe(1);

    // 3. When requested 2 -> effective 2
    expect(resolveEffectiveConcurrency(2)).toBe(2);

    // 4. When caller requests 3, 4, 10, or 99 -> hard capped at VERIFIED_GOOGLE_FLOW_CONCURRENCY_LIMIT (2)
    expect(resolveEffectiveConcurrency(3)).toBe(2);
    expect(resolveEffectiveConcurrency(4)).toBe(2);
    expect(resolveEffectiveConcurrency(10)).toBe(2);
    expect(resolveEffectiveConcurrency(99)).toBe(2);

    // 5. Invalid values (0 or negative) -> default 2
    expect(resolveEffectiveConcurrency(0)).toBe(2);
    expect(resolveEffectiveConcurrency(-5)).toBe(2);
  });

  it('runs 2 independent generation branches concurrently within verified provider limit', async () => {
    let maxConcurrentObserved = 0;
    let currentlyRunning = 0;

    const ACCOUNT = { state: 'CONNECTED' as const, email: 't@example.com' };
    const FLOW = { state: 'READY' as const, projectId: 'p-1' };
    const PROJECT = { projectId: 'p-1', projectName: 'Test Project', selectedAt: new Date().toISOString() };

    const mockAdapter = {
      healthCheck: vi.fn(async () => ({ account: ACCOUNT, flow: FLOW })),
      listProjects: vi.fn(async () => ({ projects: [], source: 'runtime' })),
      createProject: vi.fn(async (title: string) => ({ projectId: 'new-1', projectTitle: title })),
      selectProject: vi.fn(async (projectId: string) => ({ projectId, selectedAt: new Date().toISOString() })),
      uploadImage: vi.fn(),
      generate: vi.fn().mockImplementation(async (payload) => {
        currentlyRunning++;
        maxConcurrentObserved = Math.max(maxConcurrentObserved, currentlyRunning);
        await new Promise((r) => setTimeout(r, 40));
        currentlyRunning--;
        return {
          mediaId: `m-${Math.random().toString(36).slice(2)}`,
          type: 'IMAGE' as const,
          projectId: payload.projectId,
          previewUrl: 'https://cdn.example/img-1',
        };
      }),
      waitForMedia: vi.fn(async () => ({ status: 'SUCCESSFUL' as const, media: { mediaId: 'img-1', type: 'IMAGE' as const, projectId: 'p-1', previewUrl: 'https://cdn.example/img-1' } })),
      resolvePreviewUrl: vi.fn(async () => undefined),
      downloadMedia: vi.fn(async () => ({ ok: true, downloadId: 42, filename: 'C:/Downloads/img.jpg' })),
      cancel: vi.fn(async () => ({})),
    } as unknown as GoogleFlowAdapter;

    const runtime = new WorkflowRuntime(mockAdapter);

    // Graph with 2 independent prompt -> t2i branches
    const nodes: NodeSpecForValidation[] = [
      {
        id: 'p1',
        kind: 'prompt',
        inputs: [],
        outputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const }],
        config: { prompt: 'A futuristic car' },
      },
      {
        id: 't2i_1',
        kind: 't2i',
        inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const, required: true }],
        outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' as const }],
        config: { model: 'Nano Banana 2', usageKey: 'NARWHAL' },
      },
      {
        id: 'p2',
        kind: 'prompt',
        inputs: [],
        outputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const }],
        config: { prompt: 'A neon city' },
      },
      {
        id: 't2i_2',
        kind: 't2i',
        inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const, required: true }],
        outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' as const }],
        config: { model: 'Nano Banana 2', usageKey: 'NARWHAL' },
      },
    ];

    const edges = [
      { id: 'e1', source: 'p1', target: 't2i_1', sourceHandle: 'prompt', targetHandle: 'prompt' },
      { id: 'e2', source: 'p2', target: 't2i_2', sourceHandle: 'prompt', targetHandle: 'prompt' },
    ];

    const events: RuntimeEvent[] = [];
    const emit = (e: RuntimeEvent) => events.push(e);

    await runtime.run(
      nodes,
      edges,
      {
        workflowId: 'wf-concurrent-test',
        activeProject: PROJECT,
        account: ACCOUNT,
        flow: FLOW,
        concurrency: 50, // Request excessive concurrency; runtime must enforce cap = 2
      },
      emit,
    );

    // Both independent branches completed successfully
    const completedNodes = events.filter((e) => e.type === 'node' && e.state === 'success');
    expect(completedNodes.length).toBe(4);

    // Concurrency observed must be at most VERIFIED_GOOGLE_FLOW_CONCURRENCY_LIMIT (2)
    expect(maxConcurrentObserved).toBeLessThanOrEqual(VERIFIED_GOOGLE_FLOW_CONCURRENCY_LIMIT);
  });
});

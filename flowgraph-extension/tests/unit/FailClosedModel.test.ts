import { describe, expect, it, vi } from 'vitest';
import { registryModelResolver } from '../../src/runtime/registryModelResolver';
import { validateGraph, type NodeSpecForValidation } from '../../src/runtime/GraphValidator';
import { WorkflowRuntime, type RuntimeEvent } from '../../src/runtime/WorkflowRuntime';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import {
  preflightFailureCode,
  shouldToleratePreflightFailure,
} from '../../src/shared/generationPreflight';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const project = { projectId: 'proj-1' };
const supported = new Set(['prompt', 't2i', 'i2v', 't2v', 'download']);

function t2i(id: string, config: Record<string, string>): NodeSpecForValidation {
  return {
    id,
    kind: 't2i',
    config,
    inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT', required: true, configKey: 'prompt' }],
    outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' }],
  };
}

describe('fail-closed model selection', () => {
  it('rejects a stale model family that is not an exact registry variant', () => {
    const node = t2i('2', { model: 'NARWHAL-STALE', usageKey: 'NARWHAL', prompt: 'x' });
    expect(registryModelResolver(node).valid).toBe(false);
    const report = validateGraph([node], [], {
      activeProject: project,
      supportedKinds: supported,
      modelResolver: registryModelResolver,
    });
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'INVALID_MODEL' && issue.nodeIds.includes('2'))).toBe(true);
  });

  it('rejects a usageKey that does not match the configured family variant', () => {
    const node = t2i('2', { model: 'Nano Banana 2', usageKey: 'GEM_PIX_2', prompt: 'x' });
    expect(registryModelResolver(node).valid).toBe(false);
  });

  it('accepts a current registry T2I config', () => {
    const node = t2i('2', { model: 'Nano Banana 2', usageKey: 'NARWHAL', prompt: 'x' });
    expect(registryModelResolver(node)).toEqual({ valid: true });
  });

  it('runtime does not call adapter.generate when the model is invalid', async () => {
    const generate = vi.fn();
    const adapter = { generate, cancel: vi.fn() } as unknown as GoogleFlowAdapter;
    const runtime = new WorkflowRuntime(adapter);
    const nodes: NodeSpecForValidation[] = [
      {
        id: '1',
        kind: 'prompt',
        config: { prompt: 'hello' },
        inputs: [],
        outputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' }],
      },
      t2i('2', { model: 'not-a-real-family', usageKey: 'NARWHAL' }),
    ];
    const edges = [{ id: 'e1', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt' }];
    const events: RuntimeEvent[] = [];
    await expect(runtime.run(nodes, edges, {
      workflowId: 'wf',
      activeProject: { projectId: 'proj-1', projectName: 'P', selectedAt: new Date().toISOString() },
      account: { state: 'CONNECTED', email: 't@example.com' },
      flow: { state: 'READY', projectId: 'proj-1' },
    }, (event) => { events.push(event); })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(generate).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'run' && event.state === 'failed')).toBe(true);
  });

  it('does not tolerate an unverified model preflight; other optional fields still may', () => {
    expect(shouldToleratePreflightFailure({ field: 'model' }, { code: 'NO_UI_COUNTERPART' })).toBe(false);
    expect(shouldToleratePreflightFailure({ field: 'model' }, { code: 'UI_NOT_READY' })).toBe(false);
    expect(preflightFailureCode({ field: 'model' })).toBe('INVALID_MODEL');
    expect(shouldToleratePreflightFailure({ field: 'prompt' }, { code: 'NO_UI_COUNTERPART' })).toBe(true);
    expect(shouldToleratePreflightFailure({ field: 'batchCount', optional: true })).toBe(false);
    expect(shouldToleratePreflightFailure({ field: 'batchCount', optional: true }, { code: 'NO_UI_COUNTERPART' })).toBe(true);
  });

  it('service worker applyWrites no longer lists model as a tolerated fallback', () => {
    const source = readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');
    expect(source).toContain('shouldToleratePreflightFailure');
    expect(source).not.toMatch(/write\.field === 'model'/);
  });
});

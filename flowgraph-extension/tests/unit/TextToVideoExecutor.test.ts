import { describe, it, expect, vi } from 'vitest';
import { TextToVideoExecutor } from '../../src/runtime/executors/TextToVideoExecutor';
import { ExecutionContext } from '../../src/runtime/ExecutionContext';
import { textValue } from '../../src/runtime/RuntimeValue';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';

function makeContext(abortSignal: AbortSignal) {
  return new ExecutionContext({
    runId: 'run-t2v-cancel',
    workflowId: 'wf-t2v',
    activeProject: { projectId: 'proj-1', projectName: 'Test', selectedAt: '2026-09-01T00:00:00Z' },
    account: { state: 'CONNECTED', email: 't@example.com' },
    flow: { state: 'READY', projectId: 'proj-1' },
    abortSignal,
  });
}

describe('TextToVideoExecutor cancel during generate', () => {
  it('rejects promptly and does not return success when abort fires while generate is pending', async () => {
    const abort = new AbortController();
    const generateFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return { mediaId: 'vid-late', type: 'VIDEO' as const, projectId: 'proj-1', previewUrl: 'https://cdn.example/late' };
    });
    const adapter = { generate: generateFn } as unknown as GoogleFlowAdapter;
    const exec = new TextToVideoExecutor({ adapter });
    const ctx = makeContext(abort.signal);
    const started = Date.now();
    const run = exec.execute({
      runId: 'run-t2v-cancel',
      nodeId: 't2v-1',
      inputs: { prompt: textValue('A paper boat on a lake') },
      config: { model: 'Veo 3.1 - Fast', usageKey: 'veo_3_1_t2v_fast' },
      context: ctx,
    }, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 30));
    abort.abort();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('tracks only a real provider mediaId from onMediaId, never the graph nodeId', async () => {
    const abort = new AbortController();
    const generateFn = vi.fn(async (_payload, opts) => {
      const onMediaId = opts && typeof opts === 'object' && !(opts instanceof AbortSignal)
        ? (opts as { onMediaId?: (id: string) => void }).onMediaId
        : undefined;
      onMediaId?.('media-provider-t2v');
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return { mediaId: 'media-provider-t2v', type: 'VIDEO' as const, projectId: 'proj-1' };
    });
    const adapter = { generate: generateFn } as unknown as GoogleFlowAdapter;
    const exec = new TextToVideoExecutor({ adapter });
    const ctx = makeContext(abort.signal);
    const run = exec.execute({
      runId: 'run-t2v-cancel',
      nodeId: 't2v-1',
      inputs: { prompt: textValue('A paper boat on a lake') },
      config: { model: 'Veo 3.1 - Fast', usageKey: 'veo_3_1_t2v_fast' },
      context: ctx,
    }, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ctx.activeMediaIds).toEqual(['media-provider-t2v']);
    expect(ctx.activeMediaIds).not.toContain('t2v-1');
    abort.abort();
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

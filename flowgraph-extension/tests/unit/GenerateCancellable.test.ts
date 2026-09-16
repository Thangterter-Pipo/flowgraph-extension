import { describe, expect, it, vi } from 'vitest';
import { generateCancellable } from '../../src/runtime/executors/generateCancellable';
import { ExecutionContext } from '../../src/runtime/ExecutionContext';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';

function ctx(signal: AbortSignal) {
  return new ExecutionContext({
    runId: 'run-1',
    workflowId: 'wf-1',
    activeProject: { projectId: 'proj-1', projectName: 'P', selectedAt: new Date().toISOString() },
    account: { state: 'CONNECTED', email: 't@example.com' },
    flow: { state: 'READY', projectId: 'proj-1' },
    abortSignal: signal,
  });
}

describe('generateCancellable', () => {
  it('rejects promptly on abort and tracks only a real mediaId', async () => {
    const abort = new AbortController();
    const context = ctx(abort.signal);
    const generate = vi.fn((_payload, options?: { onMediaId?: (id: string) => void }) => {
      options?.onMediaId?.('provider-media-77');
      return new Promise(() => undefined);
    });
    const adapter = { generate } as unknown as GoogleFlowAdapter;
    const started = Date.now();
    const pending = generateCancellable(adapter, {
      kind: 't2i',
      projectId: 'proj-1',
      modelKey: 'NARWHAL',
    }, context, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(500);
    expect(context.activeMediaIds).toEqual(['provider-media-77']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { TextToImageExecutor } from '../../src/runtime/executors/TextToImageExecutor';
import { ExecutionContext } from '../../src/runtime/ExecutionContext';
import { RuntimeError } from '../../src/runtime/RuntimeError';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';

function executionContext(signal?: AbortSignal) {
  return new ExecutionContext({
    runId: 'run-1',
    workflowId: 'wf-1',
    activeProject: { projectId: 'proj-1', projectName: 'P', selectedAt: new Date().toISOString() },
    account: { state: 'CONNECTED', email: 't@example.com' },
    flow: { state: 'READY', projectId: 'proj-1' },
    abortSignal: signal,
  });
}

function createContext(
  signal?: AbortSignal,
  overrides?: Partial<NodeExecutionContext>,
): NodeExecutionContext {
  return {
    runId: 'run-1',
    nodeId: 'node-t2i',
    inputs: {
      prompt: { type: 'text', value: 'a paper boat on a lake' },
    },
    config: {
      model: 'Nano Banana 2',
      usageKey: 'NARWHAL',
      aspectRatio: '16:9 (Landscape)',
    },
    context: executionContext(signal),
    ...overrides,
  };
}

describe('TextToImageExecutor', () => {
  it('preserves payload, model, and project isolation on generate', async () => {
    const generate = vi.fn(async () => ({
      mediaId: 'img-ok',
      type: 'IMAGE' as const,
      projectId: 'proj-1',
      previewUrl: 'https://cdn.example/img-ok',
    }));
    const adapter = { generate } as unknown as GoogleFlowAdapter;
    const executor = new TextToImageExecutor({ adapter });
    const output = await executor.execute(createContext());

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 't2i',
      projectId: 'proj-1',
      prompt: 'a paper boat on a lake',
      modelKey: 'NARWHAL',
      aspectRatio: '16:9 (Landscape)',
    }), expect.anything());
    expect(output.result?.mediaId).toBe('img-ok');
    expect((output.outputs.image.value as { mediaId: string }).mediaId).toBe('img-ok');
  });

  it('rejects a reference from another project before generate', async () => {
    const generate = vi.fn();
    const adapter = { generate } as unknown as GoogleFlowAdapter;
    const executor = new TextToImageExecutor({ adapter });
    const ctx = createContext(undefined, {
      inputs: {
        prompt: { type: 'text', value: 'a paper boat on a lake' },
        references: {
          type: 'image',
          value: { mediaId: 'ref-1', projectId: 'other-proj', type: 'IMAGE' },
        },
      },
    });
    await expect(executor.execute(ctx)).rejects.toBeInstanceOf(RuntimeError);
    expect(generate).not.toHaveBeenCalled();
  });

  it('aborts a pending generate without returning success and tracks only a real mediaId', async () => {
    const abort = new AbortController();
    const generate = vi.fn((_payload, options?: { onMediaId?: (id: string) => void }) => {
      options?.onMediaId?.('t2i-media-real');
      return new Promise(() => undefined);
    });
    const adapter = { generate } as unknown as GoogleFlowAdapter;
    const executor = new TextToImageExecutor({ adapter });
    const ctx = createContext(abort.signal);
    const started = Date.now();
    const pending = executor.execute(ctx, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(800);
    expect(ctx.context.activeMediaIds).toEqual(['t2i-media-real']);
  });

  it('does not track or fabricate a mediaId when the provider never reports one', async () => {
    const abort = new AbortController();
    const generate = vi.fn(() => new Promise(() => undefined));
    const adapter = { generate } as unknown as GoogleFlowAdapter;
    const executor = new TextToImageExecutor({ adapter });
    const ctx = createContext(abort.signal);
    const pending = executor.execute(ctx, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ctx.context.activeMediaIds).toEqual([]);
  });

  it('never returns success if generate resolves after abort', async () => {
    const abort = new AbortController();
    let finish: ((value: unknown) => void) | undefined;
    const generate = vi.fn(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const adapter = { generate } as unknown as GoogleFlowAdapter;
    const executor = new TextToImageExecutor({ adapter });
    const ctx = createContext(abort.signal);
    const pending = executor.execute(ctx, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    abort.abort();
    finish?.({
      mediaId: 't2i-late-success',
      type: 'IMAGE',
      projectId: 'proj-1',
      previewUrl: 'https://cdn.example/late',
    });
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { RealGoogleFlowAdapter, type BridgeTransport } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import {
  applyGenerateProgress,
  endGeneration,
  finalizeGenerateAgainstAbort,
  GENERATE_PROGRESS_TYPE,
  getGenerationFlight,
  isGenerationAborted,
  markGenerationAborted,
  resetGenerationAbortState,
  throwIfGenerationAborted,
  trackGenerationMedia,
  trackGenerationStart,
  waitWhileNotAborted,
} from '../../src/shared/generationAbort';
import { makeError, makeResponse, type RequestType } from '../../src/shared/bridge';

afterEach(() => {
  resetGenerationAbortState();
});

describe('generation abort correlation', () => {
  it('tracks abort by requestId without affecting a sibling id', () => {
    markGenerationAborted('gen-a');
    expect(isGenerationAborted('gen-a')).toBe(true);
    expect(isGenerationAborted('gen-b')).toBe(false);
    endGeneration('gen-a');
    expect(isGenerationAborted('gen-a')).toBe(false);
  });

  it('applies progress only for the matching requestId', () => {
    const seen: string[] = [];
    applyGenerateProgress(
      { type: GENERATE_PROGRESS_TYPE, requestId: 'r1', mediaId: 'media-real' },
      'r1',
      (id) => seen.push(id),
    );
    applyGenerateProgress(
      { type: GENERATE_PROGRESS_TYPE, requestId: 'r2', mediaId: 'other' },
      'r1',
      (id) => seen.push(id),
    );
    applyGenerateProgress(
      { type: GENERATE_PROGRESS_TYPE, requestId: 'r1', mediaId: '' },
      'r1',
      (id) => seen.push(id),
    );
    expect(seen).toEqual(['media-real']);
  });

  it('sends FLOWGRAPH_ABORT_GENERATE with the same requestId as GENERATE', async () => {
    const calls: Array<{ type: RequestType; payload?: unknown; requestId?: string }> = [];
    let release: ((value: ReturnType<typeof makeResponse>) => void) | undefined;
    const transport: BridgeTransport = {
      request: async <T>(type: RequestType, payload?: unknown, requestId?: string) => {
        calls.push({ type, payload, requestId });
        if (type === 'FLOWGRAPH_GENERATE') {
          return await new Promise((resolve) => {
            release = resolve as (value: ReturnType<typeof makeResponse>) => void;
          });
        }
        return makeResponse<T>(requestId ?? 'abort', {} as T);
      },
    };
    const adapter = new RealGoogleFlowAdapter(transport);
    const abort = new AbortController();
    const pending = adapter.generate(
      { kind: 't2i', projectId: 'p-1', modelKey: 'NARWHAL' },
      abort.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const generateCall = calls.find((call) => call.type === 'FLOWGRAPH_GENERATE');
    expect(generateCall?.requestId).toMatch(/\S/);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    const abortCall = calls.find((call) => call.type === 'FLOWGRAPH_ABORT_GENERATE');
    expect(abortCall?.payload).toEqual({ requestId: generateCall?.requestId });
    release?.(makeError(generateCall!.requestId!, 'CANCELLED', 'late'));
  });

  it('does not abort a second in-flight generate', async () => {
    const generateIds: string[] = [];
    const transport: BridgeTransport = {
      request: async <T>(type: RequestType, payload?: unknown, requestId?: string) => {
        if (type === 'FLOWGRAPH_GENERATE') {
          generateIds.push(requestId ?? '');
          return await new Promise(() => undefined);
        }
        return makeResponse<T>(requestId ?? 'x', {} as T);
      },
    };
    const adapter = new RealGoogleFlowAdapter(transport);
    const a = new AbortController();
    const b = new AbortController();
    const first = adapter.generate({ kind: 't2i', projectId: 'p-1', modelKey: 'NARWHAL' }, a.signal);
    const second = adapter.generate({ kind: 't2i', projectId: 'p-1', modelKey: 'NARWHAL' }, b.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    a.abort();
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(generateIds).toHaveLength(2);
    expect(generateIds[0]).not.toBe(generateIds[1]);
    b.abort();
    await expect(second).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('worker abort correlation path', () => {
  async function workerGenerateLoop(
    requestId: string,
    projectId: string,
    produce: () => Promise<{ mediaId: string }>,
    cancel: (mediaId: string) => Promise<unknown>,
  ) {
    trackGenerationStart(requestId, projectId);
    throwIfGenerationAborted(requestId);
    try {
      await waitWhileNotAborted(40, requestId, 10);
      throwIfGenerationAborted(requestId);
      const result = await produce();
      return await finalizeGenerateAgainstAbort(requestId, result, cancel);
    } finally {
      endGeneration(requestId);
    }
  }

  it('adapter abort requestId is the one the worker marks, so that generate cannot succeed', async () => {
    const calls: Array<{ type: RequestType; payload?: unknown; requestId?: string }> = [];
    let releaseGenerate: ((value: ReturnType<typeof makeResponse>) => void) | undefined;
    const transport: BridgeTransport = {
      request: async <T>(type: RequestType, payload?: unknown, requestId?: string) => {
        calls.push({ type, payload, requestId });
        if (type === 'FLOWGRAPH_ABORT_GENERATE') {
          const target = (payload as { requestId?: string } | undefined)?.requestId;
          if (target) markGenerationAborted(target);
          return makeResponse<T>(requestId ?? 'abort', { aborted: true } as T);
        }
        if (type === 'FLOWGRAPH_GENERATE') {
          return await new Promise((resolve) => {
            releaseGenerate = resolve as (value: ReturnType<typeof makeResponse>) => void;
          });
        }
        return makeResponse<T>(requestId ?? 'x', {} as T);
      },
    };
    const adapter = new RealGoogleFlowAdapter(transport);
    const abort = new AbortController();
    const pending = adapter.generate(
      { kind: 't2i', projectId: 'p-1', modelKey: 'NARWHAL' },
      abort.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const generateCall = calls.find((call) => call.type === 'FLOWGRAPH_GENERATE');
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(isGenerationAborted(generateCall?.requestId)).toBe(true);

    const cancelled: string[] = [];
    await expect(
      finalizeGenerateAgainstAbort(
        generateCall!.requestId,
        { mediaId: 'late-success-media', projectId: 'p-1' },
        async (id) => { cancelled.push(id); },
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelled).toEqual(['late-success-media']);
    releaseGenerate?.(makeError(generateCall!.requestId!, 'CANCELLED', 'worker stopped'));
  });

  it('an aborted generation cannot continue to success; a sibling request still completes', async () => {
    const cancelled: string[] = [];
    const cancel = async (id: string) => { cancelled.push(id); };

    markGenerationAborted('run-stop');
    const stopped = workerGenerateLoop(
      'run-stop',
      'p-1',
      async () => ({ mediaId: 'must-not-cache' }),
      cancel,
    );
    await expect(stopped).rejects.toMatchObject({ code: 'CANCELLED' });

    const sibling = await workerGenerateLoop(
      'run-live',
      'p-1',
      async () => ({ mediaId: 'media-ok' }),
      cancel,
    );
    expect(sibling).toEqual({ mediaId: 'media-ok' });
    expect(cancelled).toEqual([]);
    expect(isGenerationAborted('run-live')).toBe(false);
  });

  it('wait loop exits early on abort instead of returning later success', async () => {
    const started = Date.now();
    setTimeout(() => markGenerationAborted('wait-stop'), 30);
    await expect(waitWhileNotAborted(5_000, 'wait-stop', 10)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1_000);

    await expect(waitWhileNotAborted(40, 'wait-live', 10)).resolves.toBeUndefined();
  });

  it('cancels only the real provider mediaId of the aborted request, never a graph nodeId sibling', async () => {
    trackGenerationStart('gen-1', 'p-1');
    trackGenerationStart('gen-2', 'p-1');
    trackGenerationMedia('gen-1', '11111111-1111-4111-8111-111111111111');
    trackGenerationMedia('gen-2', '22222222-2222-4222-8222-222222222222');
    markGenerationAborted('gen-1');

    const cancelled: string[] = [];
    await expect(
      finalizeGenerateAgainstAbort(
        'gen-1',
        { mediaId: getGenerationFlight('gen-1')?.mediaId },
        async (id) => { cancelled.push(id); },
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED' });

    const sibling = await finalizeGenerateAgainstAbort(
      'gen-2',
      { mediaId: getGenerationFlight('gen-2')?.mediaId },
      async (id) => { cancelled.push(id); },
    );
    expect(sibling.mediaId).toBe('22222222-2222-4222-8222-222222222222');
    expect(cancelled).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(getGenerationFlight('gen-2')?.mediaId).not.toBe('node-t2i-1');
  });
});

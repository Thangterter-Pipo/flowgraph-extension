import { describe, it, expect, vi } from 'vitest';
import { FlowUiLease, FlowUiMutex } from '../src/background/FlowUiLease';
import { exactEditorPromptMatches } from '../src/background/videoTileDetection';
import { WorkflowRuntime, type RuntimeEvent } from '../src/runtime/WorkflowRuntime';
import type { GoogleFlowAdapter } from '../src/adapters/google-flow/GoogleFlowAdapter';
import type { NodeSpecForValidation } from '../src/runtime/GraphValidator';

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe('pipelined T2V verification', () => {
  it('yields composer after submit, permits second submission before first render, serializes attribution', async () => {
    const mutex = new FlowUiMutex();
    const first = new FlowUiLease(mutex, () => {});
    const second = new FlowUiLease(mutex, () => {});
    const trace: string[] = [];
    await first.acquire();
    trace.push('submit A');
    const b = second.acquire().then(() => { trace.push('submit B'); });
    await tick();
    expect(trace).toEqual(['submit A']);
    first.yield();
    await b;
    const a = first.acquire().then(() => { trace.push('finish A'); });
    await tick();
    expect(trace).toEqual(['submit A', 'submit B']);
    second.yield();
    await a;
    first.yield();
    expect(trace).toEqual(['submit A', 'submit B', 'finish A']);
  });

  it('cancelled waiter never touches composer and does not poison lock queue', async () => {
    const mutex = new FlowUiMutex();
    const release = await mutex.acquire();
    const cancelled = mutex.acquire(() => { throw new Error('cancelled'); });
    const rejected = expect(cancelled).rejects.toThrow('cancelled');
    release();
    await rejected;
    const next = await mutex.acquire();
    next(); next();
    (await mutex.acquire())();
  });

  it('responsive abort while waiting in acquire queue', async () => {
    const mutex = new FlowUiMutex();
    const release = await mutex.acquire();
    let aborted = false;
    const waiter = mutex.acquire(() => {
      if (aborted) throw new Error('cancelled mid-wait');
    });
    await new Promise(r => setTimeout(r, 50));
    aborted = true; // Trigger abort while previous is still holding lock
    await expect(waiter).rejects.toThrow('cancelled mid-wait');
    release(); // Release previous lock
    // Mutex tail is not poisoned
    const next = await mutex.acquire();
    next();
  });

  it('does not confuse common continuity prefix or truncated prompt with a different scene', () => {
    const prefix = 'MASTER CONTINUITY, 16:9, 24fps. Same recurring character. ';
    expect(exactEditorPromptMatches(prefix + 'Birthday candle', prefix + 'Morning departure')).toBe(false);
    expect(exactEditorPromptMatches(prefix, prefix + 'Morning departure')).toBe(false);
    expect(exactEditorPromptMatches(' A  B\nC ', 'a b c')).toBe(true);
    expect(exactEditorPromptMatches('', '')).toBe(false);

    // Prompt > 200 characters matches correctly when editor truncates at 200 characters
    const longExpected = 'MASTER CONTINUITY, 16:9, 24fps. Same recurring character. ' + 'A'.repeat(250) + ' END';
    const editorTruncated = longExpected.slice(0, 200);
    expect(exactEditorPromptMatches(editorTruncated, longExpected)).toBe(true);
  });

  it.each([false, true])('runtime respects bounded independent jobs with pipeline=%s', async (pipeline) => {
    let active = 0, peak = 0;
    const order: string[] = [];
    const account = { state: 'CONNECTED' as const, email: 'test@example.invalid' };
    const flow = { state: 'READY' as const, projectId: 'p' };
    const project = { projectId: 'p', projectName: 'test', selectedAt: new Date().toISOString() };
    const adapter = {
      healthCheck: vi.fn(async () => ({ account, flow })),
      generate: vi.fn(async (payload) => {
        active++; peak = Math.max(peak, active);
        order.push('submit ' + payload.prompt);
        await new Promise(r => setTimeout(r, payload.prompt === 'one' ? 40 : 10));
        order.push('finish ' + payload.prompt);
        active--;
        return { mediaId: payload.prompt, projectId: 'p', type: 'VIDEO', provider: 'GOOGLE_FLOW', completedViaUi: true, previewUrl: 'https://example.invalid/' + payload.prompt };
      }),
      waitForMedia: vi.fn(), cancel: vi.fn(async () => ({})),
    } as unknown as GoogleFlowAdapter;
    const nodes: NodeSpecForValidation[] = ['one', 'two', 'three'].flatMap((id) => [
      { id: 'p-' + id, kind: 'prompt', inputs: [], outputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const }], config: { prompt: id } },
      { id, kind: 't2v', inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' as const, required: true }], outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' as const }], config: { model: 'Veo 3.1 - Fast', usageKey: 'veo_3_1_t2v_fast', duration: '8 seconds', aspectRatio: '16:9' } },
    ]);
    const edges = ['one', 'two', 'three'].map(id => ({ id: 'e-' + id, source: 'p-' + id, target: id, sourceHandle: 'prompt', targetHandle: 'prompt' }));
    const events: RuntimeEvent[] = [];
    await new WorkflowRuntime(adapter).run(nodes, edges, { workflowId: 'pipeline', activeProject: project, account, flow, concurrency: 1, flowUiPipeline: pipeline }, e => events.push(e));
    expect(peak).toBe(pipeline ? 2 : 1);
    expect(events.filter(e => e.type === 'node' && e.state === 'success')).toHaveLength(6);
    if (pipeline) expect(order.indexOf('submit two')).toBeLessThan(order.indexOf('finish one'));
    expect(adapter.waitForMedia).not.toHaveBeenCalled();
  });
});

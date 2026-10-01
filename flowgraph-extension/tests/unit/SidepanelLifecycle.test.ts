import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSidepanel } from '../../src/ui/sidepanel/lifecycle';
import { HISTORY_KEY } from '../../src/ui/sidepanel/state';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Sidepanel lifecycle', () => {
  it('uses real events plus 15s fallback, refreshes storage and removes listeners/timer', () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    vi.stubGlobal('window', events);
    const listeners = new Set<(message: any) => void>();
    vi.stubGlobal('chrome', { runtime: { onMessage: {
      addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn),
    } } });
    const controller = { refresh: vi.fn().mockResolvedValue(undefined), loadProjects: vi.fn().mockResolvedValue(undefined),
      flowChanged: vi.fn(), runtimeEvent: vi.fn(), dispose: vi.fn() };
    const history = vi.fn();
    const cleanup = bindSidepanel(controller, history);
    expect(controller.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(14_999);
    expect(controller.refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(controller.refresh).toHaveBeenCalledTimes(2);
    const send = [...listeners][0];
    send({ type: 'FLOWGRAPH_EVENT', payload: { flow: { state: 'PROJECT_REQUIRED' } } });
    expect(controller.flowChanged).toHaveBeenCalledWith({ state: 'PROJECT_REQUIRED' });
    send({ type: 'FLOWGRAPH_EVENT', kind: 'run:state', runId: 'r', status: 'cancelled' });
    expect(controller.runtimeEvent).toHaveBeenCalledTimes(1);
    const before = history.mock.calls.length;
    events.dispatchEvent(Object.assign(new Event('storage'), { key: HISTORY_KEY }));
    expect(history).toHaveBeenCalledTimes(before + 1);
    cleanup();
    expect(listeners.size).toBe(0);
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    const calls = history.mock.calls.length;
    vi.advanceTimersByTime(30_000);
    events.dispatchEvent(Object.assign(new Event('storage'), { key: HISTORY_KEY }));
    expect(history).toHaveBeenCalledTimes(calls);
  });
});

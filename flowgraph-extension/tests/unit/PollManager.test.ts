import { describe, expect, it, vi } from 'vitest';
import { PollManager } from '../../src/runtime/PollManager';

describe('PollManager', () => {
  it('returns SUCCESSFUL when the provider completes', async () => {
    const poller = new PollManager({ intervalMs: 5, maxWaitMs: 500 });
    let calls = 0;
    const result = await poller.untilTerminal(async () => {
      calls += 1;
      return calls < 2 ? { status: 'ACTIVE' } : { status: 'SUCCESSFUL', data: { mediaId: 'x' } };
    });
    expect(result.status).toBe('SUCCESSFUL');
    expect(result.data).toEqual({ mediaId: 'x' });
  });

  it('returns FAILED terminal state without retrying', async () => {
    const poller = new PollManager({ intervalMs: 5, maxWaitMs: 500 });
    const probe = vi.fn(async () => ({ status: 'FAILED' as const, errorMessage: 'boom' }));
    const result = await poller.untilTerminal(probe);
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toBe('boom');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('aborts on signal', async () => {
    const poller = new PollManager({ intervalMs: 5, maxWaitMs: 500 });
    const controller = new AbortController();
    controller.abort();
    await expect(poller.untilTerminal(async () => ({ status: 'ACTIVE' }), { abortSignal: controller.signal }))
      .rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('aborts immediately during sleep when signal fires mid-interval', async () => {
    const poller = new PollManager({ intervalMs: 10_000, maxWaitMs: 60_000 });
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    await expect(poller.untilTerminal(async () => ({ status: 'ACTIVE' }), { abortSignal: controller.signal }))
      .rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('times out to UNKNOWN beyond maxWaitMs', async () => {
    const poller = new PollManager({ intervalMs: 5, maxWaitMs: 20 });
    const controller = new AbortController();
    const result = await poller.untilTerminal(async () => ({ status: 'ACTIVE' }), { abortSignal: controller.signal });
    expect(result.status).toBe('UNKNOWN');
    expect(result.errorMessage).toContain('timed out');
  }, 5_000);
});

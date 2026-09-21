import { describe, expect, it } from 'vitest';
import { planStitchTimeline, stitchWait } from '../../src/runtime/stitch/BrowserStitchEngine';

describe('Stitch timeline', () => {
  it('bounds stalled work and preserves cancellation', async () => {
    await expect(stitchWait(new Promise(() => {}), undefined, 5)).rejects.toMatchObject({ code: 'TIMEOUT' });
    const controller = new AbortController();
    const pending = stitchWait(new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('keeps all four full clips in order and subtracts only real overlaps', () => {
    const timeline = planStitchTimeline([2, 3, 4, 5], { transition: 'crossfade', transitionDuration: '0.5s' });
    expect(timeline.starts).toEqual([0, 1.5, 4, 7.5]);
    expect(timeline.duration).toBe(12.5);
    expect(planStitchTimeline([2, 3, 4, 5], { transition: 'crossfade_1s' }).duration).toBe(11);
    expect(planStitchTimeline([2, 3, 4, 5], { transition: 'cut' }).duration).toBe(14);
  });
  it('rejects invalid durations, unsupported transitions and overlapping triple clips', () => {
    for (const durations of [[0, 2], [Infinity, 2], [NaN, 2], [2, 0.8, 2]]) {
      expect(() => planStitchTimeline(durations, { transition: 'crossfade_1s' })).toThrow();
    }
    expect(() => planStitchTimeline([2, 3], { transition: 'wipe' })).toThrow();
    expect(() => planStitchTimeline([2, 3], { transition: 'crossfade', transitionDuration: 'garbage' })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { creditsView, readLastRun, runStatusText } from '../../src/ui/sidepanel/state';

describe('Sidepanel truthful data', () => {
  it('never treats tier or missing credits as a balance', () => {
    expect(creditsView(undefined, false)).toEqual({ state: 'unknown', text: 'Chưa xác định' });
    expect(creditsView({ serviceTier: 'SERVICE_TIER_PRO' }, false).state).toBe('unknown');
    expect(creditsView({ credits: 0 }, false)).toEqual({ state: 'zero', text: '0' });
    expect(creditsView({ credits: 120 }, false).text).toBe('120');
    expect(creditsView({ credits: 10, error: 'offline' }, false).state).toBe('error');
    expect(creditsView({ credits: NaN }, false).state).toBe('unknown');
    expect(creditsView({ credits: -1 }, false).state).toBe('unknown');
    expect(creditsView({ credits: 10 }, true).state).toBe('loading');
  });
  it('uses real projectId/status schema, preserving unknown and canceled', () => {
    const runs = JSON.stringify([
      { runId: 'other', projectId: 'b', status: 'failed' },
      { runId: 'mine', projectId: 'a', workflowName: 'Mẫu', status: 'cancelled' },
    ]);
    expect(readLastRun(runs, 'a')?.runId).toBe('mine');
    expect(readLastRun(runs, 'c')).toBeNull();
    expect(readLastRun('[{"runId":"old","status":"success"},{"runId":"scoped","projectId":"a","status":"running"}]', 'a')?.runId).toBe('scoped');
    expect(runStatusText('cancelled')).toBe('Đã hủy');
    expect(runStatusText('canceled')).toBe('Đã hủy');
    expect(runStatusText('running')).toBe('Đang chạy');
    expect(runStatusText('success')).toBe('Thành công');
    expect(runStatusText('failed')).toBe('Thất bại');
    expect(runStatusText('future-status')).toBe('Chưa xác định');
    expect(readLastRun(null, 'a')).toBeNull();
    expect(() => readLastRun('{broken', 'a')).toThrow();
    expect(() => readLastRun('{}', 'a')).toThrow();
    expect(readLastRun('[null, 1, {"runId":"legacy","status":"success"}]', 'a')?.runId).toBe('legacy');
  });
});

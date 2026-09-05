// SyncConflictGuard tests — project isolation, replay/loop protection,
// echo suppression semantics, and deterministic conflict resolution.
import { describe, expect, it } from 'vitest';
import { SyncConflictGuard } from '../../src/shared/sync/SyncConflictGuard';
import type { FlowSyncEvent } from '../../src/shared/sync/FlowSyncTypes';

const PROJECT = '23e7d6d8-d0bc-441b-b720-e63b0ffa9d32';

function event(overrides: Partial<FlowSyncEvent> = {}): FlowSyncEvent {
  return {
    syncId: 's1',
    timestamp: '2026-09-03T00:00:00.000Z',
    source: 'GOOGLE_FLOW',
    projectId: PROJECT,
    field: 'prompt',
    value: 'hello',
    sequence: 1,
    ...overrides,
  };
}

describe('SyncConflictGuard', () => {
  it('rejects events from another project before anything else', () => {
    const guard = new SyncConflictGuard({ projectId: PROJECT });
    const decision = guard.decide(event({ projectId: 'different' }));
    expect(decision).toMatchObject({ action: 'ignore', code: 'PROJECT_MISMATCH' });
  });

  it('rejects non-monotonic sequences as stale', () => {
    const guard = new SyncConflictGuard({ projectId: PROJECT });
    expect(guard.decide(event({ sequence: 10 })).action).toBe('apply');
    // Same sequence without an originEventId is indistinguishable from a replay → stale.
    expect(guard.decide(event({ sequence: 10, syncId: 'same-seq' }))).toMatchObject({
      action: 'ignore',
      code: 'STALE_EVENT',
    });
    expect(guard.decide(event({ sequence: 9, syncId: 'older' }))).toMatchObject({
      action: 'ignore',
      code: 'STALE_EVENT',
    });
    expect(guard.decide(event({ sequence: 11, syncId: 'newer' })).action).toBe('apply');
  });

  it('accepts a sequence reset from a new producer lifecycle and rejects the retired instance', () => {
    const guard = new SyncConflictGuard({ projectId: PROJECT });
    expect(guard.decide(event({ sequence: 8, sourceInstanceId: 'page-a', originEventId: 'page-a-8' })).action).toBe('apply');
    expect(guard.decide(event({ sequence: 1, sourceInstanceId: 'page-b', originEventId: 'page-b-1' })).action).toBe('apply');
    expect(guard.decide(event({ sequence: 9, sourceInstanceId: 'page-a', originEventId: 'page-a-9' }))).toMatchObject({
      action: 'ignore',
      code: 'STALE_EVENT',
    });
  });

  it('rejects an exact replay of an originEventId as a loop', () => {
    const guard = new SyncConflictGuard({ projectId: PROJECT });
    const first = event({ sequence: 10, originEventId: 'studio-model-1', syncId: 'echo-a' });
    const replay = event({ sequence: 11, originEventId: 'studio-model-1', syncId: 'echo-b' });
    expect(guard.decide(first).action).toBe('apply');
    expect(guard.decide(replay)).toMatchObject({ action: 'ignore', code: 'LOOP_SUPPRESSED' });
  });

  it('suppresses a matching write echo once, then allows genuine same-value edits', () => {
    const guard = new SyncConflictGuard({ projectId: PROJECT });
    guard.markWrite({
      direction: 'STUDIO_TO_FLOW',
      field: 'prompt',
      value: 'hello',
      sequence: 1,
      originEventId: 'studio-prompt-1',
    });

    const echo = event({ value: 'hello', originEventId: 'studio-prompt-1' });
    expect(guard.decide(echo)).toMatchObject({ action: 'ignore', code: 'LOOP_SUPPRESSED' });

    const manualSameValue = event({ value: 'hello', sequence: 2, syncId: 'manual' });
    expect(guard.decide(manualSameValue).action).toBe('apply');
  });

  it('does not suppress a Flow edit that differs from the pending write', () => {
    const guard = new SyncConflictGuard({ projectId: PROJECT });
    guard.markWrite({
      direction: 'STUDIO_TO_FLOW',
      field: 'prompt',
      value: 'hello',
      sequence: 1,
    });
    expect(guard.decide(event({ value: 'changed', sequence: 1 })).action).toBe('apply');
    expect(guard.decide(event({ value: 'hello', sequence: 2, syncId: 'manual-back' })).action).toBe('apply');
  });

  it('resolves conflicts deterministically: last user action wins', () => {
    const guard = new SyncConflictGuard({ projectId: PROJECT });
    const flowEdit = event({ sequence: 7, value: 'from flow' });
    const studioEdit = event({ source: 'FLOWGRAPH', sequence: 9, value: 'from studio' });
    expect(guard.resolveConflict(flowEdit, studioEdit).winner.value).toBe('from studio');

    // Same sequence, same timestamp → deterministic FLOWGRAPH tie-break.
    const a = event({ sequence: 5, source: 'GOOGLE_FLOW', value: 'flow' });
    const b = event({ sequence: 5, source: 'FLOWGRAPH', value: 'studio' });
    expect(guard.resolveConflict(a, b).winner.source).toBe('FLOWGRAPH');
    expect(guard.resolveConflict(b, a).winner.source).toBe('FLOWGRAPH');

    // Same sequence, newer timestamp wins regardless of side.
    const older = event({ sequence: 3, timestamp: '2026-09-03T00:00:00.000Z' });
    const newer = event({ sequence: 3, timestamp: '2026-09-03T00:00:05.000Z' });
    expect(guard.resolveConflict(older, newer).winner.timestamp).toBe('2026-09-03T00:00:05.000Z');
  });
});

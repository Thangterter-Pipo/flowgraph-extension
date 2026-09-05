// FlowSyncController orchestration tests (FG sync step 1 — pure logic).
import { beforeEach, describe, expect, it } from 'vitest';
import { FlowSyncController, type SyncPreflightInput } from '../../src/shared/sync/FlowSyncController';
import type { FlowSyncEvent, FlowSyncField } from '../../src/shared/sync/FlowSyncTypes';

const PROJECT = '23e7d6d8-d0bc-441b-b720-e63b0ffa9d32';

interface FakeTimer {
  id: number;
  runAt: number;
  callback: () => void;
}

class FakeClock {
  private nowMs = 1_700_000_000_000;
  private timers: FakeTimer[] = [];
  private nextId = 1;

  now(): number {
    return this.nowMs;
  }

  schedule(callback: () => void, delayMs: number): unknown {
    const timer: FakeTimer = { id: this.nextId++, runAt: this.nowMs + delayMs, callback };
    this.timers.push(timer);
    return timer.id;
  }

  cancel(handle: unknown): void {
    const id = handle as number;
    this.timers = this.timers.filter((timer) => timer.id !== id);
  }

  advance(ms: number): void {
    this.nowMs += ms;
    const due = this.timers.filter((timer) => timer.runAt <= this.nowMs);
    this.timers = this.timers.filter((timer) => timer.runAt > this.nowMs);
    due.forEach((timer) => timer.callback());
  }
}

function makeEvent(overrides: Partial<FlowSyncEvent> = {}): FlowSyncEvent {
  return {
    syncId: 'flow-evt',
    timestamp: new Date().toISOString(),
    source: 'GOOGLE_FLOW',
    projectId: PROJECT,
    nodeId: '2',
    field: 'prompt',
    value: 'manual flow prompt',
    sequence: 1,
    ...overrides,
  };
}

function makeHarness() {
  const clock = new FakeClock();
  const flowWrites: FlowSyncEvent[] = [];
  const studioWrites: FlowSyncEvent[] = [];
  const controller = new FlowSyncController({
    projectId: PROJECT,
    toFlow: { write: (event) => flowWrites.push(event) },
    toStudio: { write: (event) => studioWrites.push(event) },
    clock,
    promptDebounceMs: 250,
  });
  return { clock, flowWrites, studioWrites, controller };
}

describe('FlowSyncController', () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('rejects non-generation nodes as active sync targets', () => {
    const decision = harness.controller.setActiveNode('1', 'prompt');
    expect(decision).toEqual({
      action: 'ignore',
      code: 'UNSUPPORTED_NODE',
      reason: expect.stringContaining('prompt'),
    });
    expect(harness.flowWrites).toHaveLength(0);
  });

  it('activates a generation node and asserts the composer mode toward Flow', () => {
    const decision = harness.controller.setActiveNode('2', 't2i');
    expect(decision.action).toBe('apply');
    expect(harness.flowWrites).toHaveLength(1);
    expect(harness.flowWrites[0]).toMatchObject({
      source: 'FLOWGRAPH',
      projectId: PROJECT,
      nodeId: '2',
      field: 'mode',
      value: 'IMAGE',
      originEventId: expect.stringMatching(/^studio-mode-/),
    });
  });

  it('debounces studio prompt writes and flushes toward Flow once', () => {
    harness.controller.setActiveNode('2', 't2i');
    const first = harness.controller.handleStudioChange({ nodeId: '2', field: 'prompt', value: 'draft one' });
    expect(first.action).toBe('apply');
    expect(harness.flowWrites).toHaveLength(1); // only the mode write so far

    harness.controller.handleStudioChange({ nodeId: '2', field: 'prompt', value: 'draft two' });
    expect(harness.flowWrites).toHaveLength(1);

    harness.clock.advance(250);
    expect(harness.flowWrites).toHaveLength(2);
    expect(harness.flowWrites[1]).toMatchObject({ field: 'prompt', value: 'draft two' });
  });

  it('routes genuine Flow events without a provider node id to the active Studio node', () => {
    harness.controller.setActiveNode('active-t2i', 't2i');
    const decision = harness.controller.handleFlowEvent(
      makeEvent({ nodeId: undefined, field: 'model', value: 'NARWHAL', sequence: 1 }),
    );
    expect(decision.action).toBe('apply');
    expect(harness.studioWrites).toHaveLength(1);
    expect(harness.studioWrites[0]).toMatchObject({
      nodeId: 'active-t2i',
      field: 'model',
      value: 'NARWHAL',
    });
    const snapshot = harness.controller.getActiveSnapshot();
    expect(snapshot?.fields.model).toMatchObject({ status: 'synced', value: 'NARWHAL' });
  });

  it('accepts a manual Flow mode event for a generation node so Studio can expose mode drift', () => {
    harness.controller.setActiveNode('video-node', 't2v');
    const decision = harness.controller.handleFlowEvent(
      makeEvent({ nodeId: undefined, field: 'mode', value: 'IMAGE', sequence: 1 }),
    );
    expect(decision.action).toBe('apply');
    expect(harness.studioWrites.at(-1)).toMatchObject({
      nodeId: 'video-node',
      field: 'mode',
      value: 'IMAGE',
    });
  });

  it('ignores settings observed from an incompatible Flow composer mode', () => {
    harness.controller.setActiveNode('video-node', 't2v');
    expect(harness.controller.handleFlowEvent(
      makeEvent({ nodeId: undefined, field: 'mode', value: 'IMAGE', sequence: 1 }),
    ).action).toBe('apply');
    expect(harness.controller.handleFlowEvent(
      makeEvent({ nodeId: undefined, field: 'model', value: 'Nano Banana 2', sequence: 2 }),
    )).toMatchObject({ action: 'ignore', code: 'MODE_MISMATCH' });
    expect(harness.studioWrites).toHaveLength(1);

    expect(harness.controller.handleFlowEvent(
      makeEvent({ nodeId: undefined, field: 'mode', value: 'VIDEO', sequence: 3 }),
    ).action).toBe('apply');
    expect(harness.controller.handleFlowEvent(
      makeEvent({ nodeId: undefined, field: 'model', value: 'Omni 1.1 Flash', sequence: 4 }),
    ).action).toBe('apply');
  });

  it('routes a correlated manual Flow generation result to the active node', () => {
    harness.controller.setActiveNode('video-node', 't2v');
    const decision = harness.controller.handleFlowEvent(makeEvent({
      nodeId: undefined,
      field: 'resultMedia',
      value: { mediaId: 'generated-media-id', type: 'VIDEO', status: 'COMPLETED' },
      sequence: 1,
    }));
    expect(decision.action).toBe('apply');
    expect(harness.studioWrites.at(-1)).toMatchObject({
      nodeId: 'video-node',
      field: 'resultMedia',
      value: { mediaId: 'generated-media-id', type: 'VIDEO' },
    });
  });

  it('routes an exact Flow Start Frame media id to the active i2v node', () => {
    harness.controller.setActiveNode('i2v-node', 'i2v');
    const decision = harness.controller.handleFlowEvent(makeEvent({
      nodeId: undefined,
      field: 'startImage',
      value: { mediaId: 'a4303113-5fce-43d1-8c1d-f261bbb32ebf' },
      sequence: 1,
    }));
    expect(decision.action).toBe('apply');
    expect(harness.studioWrites.at(-1)).toMatchObject({
      nodeId: 'i2v-node',
      field: 'startImage',
      value: { mediaId: 'a4303113-5fce-43d1-8c1d-f261bbb32ebf' },
    });
  });

  it('keeps Start and End Frame reverse events in distinct slots', () => {
    harness.controller.setActiveNode('interpolation-node', 'interpolation');
    expect(harness.controller.handleFlowEvent(makeEvent({
      nodeId: undefined,
      field: 'startImage',
      value: { mediaId: 'start-media' },
      sequence: 1,
    })).action).toBe('apply');
    expect(harness.controller.handleFlowEvent(makeEvent({
      nodeId: undefined,
      field: 'endImage',
      value: { mediaId: 'end-media' },
      sequence: 2,
    })).action).toBe('apply');
    expect(harness.studioWrites.slice(-2)).toMatchObject([
      { nodeId: 'interpolation-node', field: 'startImage', value: { mediaId: 'start-media' } },
      { nodeId: 'interpolation-node', field: 'endImage', value: { mediaId: 'end-media' } },
    ]);
  });

  it('preserves ordered Reference Media ids on reverse sync', () => {
    harness.controller.setActiveNode('reference-node', 'reference');
    const references = [{ mediaId: 'reference-a' }, { mediaId: 'reference-b' }];
    const decision = harness.controller.handleFlowEvent(makeEvent({
      nodeId: undefined,
      field: 'referenceMedia',
      value: references,
      sequence: 1,
      userInitiated: true,
    }));
    expect(decision.action).toBe('apply');
    expect(harness.studioWrites.at(-1)).toMatchObject({
      nodeId: 'reference-node',
      field: 'referenceMedia',
      value: references,
    });
  });

  it('suppresses the Flow echo of a Studio write exactly once (loop prevention)', () => {
    harness.controller.setActiveNode('2', 't2i');
    harness.controller.handleStudioChange({ nodeId: '2', field: 'model', value: 'NARWHAL' });
    const write = harness.flowWrites[harness.flowWrites.length - 1];
    expect(write.field).toBe('model');

    const echo = makeEvent({
      field: 'model',
      value: 'NARWHAL',
      sequence: 1,
      originEventId: write.originEventId,
      syncId: 'echo',
    });
    const decision = harness.controller.handleFlowEvent(echo);
    expect(decision).toMatchObject({ action: 'ignore', code: 'LOOP_SUPPRESSED' });
    expect(harness.studioWrites).toHaveLength(0);

    // A later manual Flow edit with the SAME value must still apply (marker cleared).
    const manual = makeEvent({ field: 'model', value: 'NARWHAL', sequence: 2, syncId: 'manual' });
    expect(harness.controller.handleFlowEvent(manual).action).toBe('apply');
    expect(harness.studioWrites).toHaveLength(1);
  });

  it('drops stale and duplicate Flow events by monotonic sequence and origin id', () => {
    harness.controller.setActiveNode('2', 't2i');
    expect(
      harness.controller.handleFlowEvent(makeEvent({ sequence: 5, syncId: 'e5' })).action,
    ).toBe('apply');
    expect(
      harness.controller.handleFlowEvent(makeEvent({ sequence: 5, syncId: 'e5-dup' })).action,
    ).toBe('ignore');
    const stale = harness.controller.handleFlowEvent(makeEvent({ sequence: 4, syncId: 'e4' }));
    expect(stale).toMatchObject({ action: 'ignore', code: 'STALE_EVENT' });
  });

  it('enforces project isolation on Flow events', () => {
    harness.controller.setActiveNode('2', 't2i');
    const decision = harness.controller.handleFlowEvent(
      makeEvent({ projectId: 'other-project', sequence: 1 }),
    );
    expect(decision).toMatchObject({ action: 'ignore', code: 'PROJECT_MISMATCH' });
    expect(harness.studioWrites).toHaveLength(0);
  });

  it('ignores changes from non-active nodes and unsupported fields', () => {
    harness.controller.setActiveNode('2', 't2i');
    expect(
      harness.controller.handleStudioChange({ nodeId: '3', field: 'prompt', value: 'x' }),
    ).toMatchObject({ action: 'ignore', code: 'STALE_EVENT' });
    expect(
      harness.controller.handleStudioChange({ nodeId: '2', field: 'durationSeconds', value: 8 }),
    ).toMatchObject({ action: 'ignore', code: 'UNSUPPORTED_FIELD' });
  });

  it('re-targets sync on node switch and maps the matching mode', () => {
    harness.controller.setActiveNode('2', 't2i');
    harness.controller.setActiveNode('3', 'i2v');
    const snapshot = harness.controller.getActiveSnapshot();
    expect(snapshot).toMatchObject({ nodeId: '3', nodeKind: 'i2v', mode: 'VIDEO' });
    const modeWrite = harness.flowWrites.at(-1);
    expect(modeWrite).toMatchObject({ nodeId: '3', field: 'mode', value: 'VIDEO' });
  });

  it('preflight fails closed: missing bindings or unverified UI block Generate', () => {
    harness.controller.setActiveNode('3', 'i2v');
    const base: SyncPreflightInput = {
      projectId: PROJECT,
      nodeKind: 'i2v',
      values: {
        prompt: 'camera push in',
        model: 'veo_3_1_i2v_s_fast',
        aspectRatio: '16:9 (Landscape)',
        durationSeconds: 8,
      } as Partial<Record<FlowSyncField, unknown>>,
      uiVerified: false,
    };
    const missingBinding = harness.controller.preflight(base);
    expect(missingBinding.ok).toBe(false);
    expect(missingBinding.blocking.map((check) => check.id)).toContain('mediaBinding');
    expect(missingBinding.blocking.map((check) => check.code)).toContain('NO_UI_COUNTERPART');

    const blocked = harness.controller.preflight({
      ...base,
      values: { ...base.values, startImage: { mediaId: 'img-1' } },
      uiVerified: false,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocking.map((check) => check.id)).toContain('generate');

    const ready = harness.controller.preflight({
      ...base,
      values: { ...base.values, startImage: { mediaId: 'img-1' } },
      uiVerified: true,
    });
    expect(ready.ok).toBe(true);
    expect(ready.blocking).toHaveLength(0);
  });
});

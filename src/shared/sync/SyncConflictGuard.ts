// Loop prevention + deterministic conflict resolution.
//
// Rules:
// 1. Project isolation first — events from another project are dropped.
// 2. Monotonic sequence per source — old replays are stale.
// 3. originEventId dedupe — the same event is never applied twice.
// 4. lastAppliedValue echo suppression — a write issued toward one side is
//    suppressed exactly once when that side reports the same value back
//    (DOM observers fire on programmatic changes too). The marker is cleared
//    after matching so a later manual edit back to the same value still applies.
// 5. Conflicts resolve deterministically: LAST USER ACTION WINS = highest
//    sequence, then newest timestamp, then FLOWGRAPH source as final tie-break.
import type {
  FlowSyncEvent,
  FlowSyncField,
  FlowSyncSource,
  SyncDecision,
} from './FlowSyncTypes';
import { applyDecision, ignoreDecision, sameSyncValue } from './FlowSyncTypes';

type SyncDirection = 'STUDIO_TO_FLOW' | 'FLOW_TO_STUDIO';

interface WriteMarker {
  field: FlowSyncField;
  value: unknown;
  sequence: number;
  originEventId?: string;
}

const MAX_SEEN_ORIGIN_IDS = 256;

export interface SyncGuardOptions {
  projectId: string;
}

/**
 * Given the side that will ECHO a write, return the direction of the write
 * that produced it: an echo from Flow suppresses a STUDIO_TO_FLOW write, and
 * an echo from Studio suppresses a FLOW_TO_STUDIO write.
 */
export function echoDirectionForSource(source: FlowSyncSource): SyncDirection {
  return source === 'GOOGLE_FLOW' ? 'STUDIO_TO_FLOW' : 'FLOW_TO_STUDIO';
}

export class SyncConflictGuard {
  private readonly projectId: string;
  private lastSequence: Partial<Record<FlowSyncSource, number>> = {};
  private readonly sourceInstances: Partial<Record<FlowSyncSource, string>> = {};
  private readonly retiredSourceInstances = new Set<string>();
  private readonly seenOriginIds = new Set<string>();
  private readonly writeMarkers = new Map<SyncDirection, Map<FlowSyncField, WriteMarker>>();

  constructor(options: SyncGuardOptions) {
    this.projectId = options.projectId;
  }

  get expectedProjectId(): string {
    return this.projectId;
  }

  decide(event: FlowSyncEvent): SyncDecision {
    if (event.projectId !== this.projectId) {
      return ignoreDecision('PROJECT_MISMATCH', `Event project ${event.projectId} does not match active project`);
    }
    if (event.sourceInstanceId) {
      const instanceKey = `${event.source}:${event.sourceInstanceId}`;
      if (this.retiredSourceInstances.has(instanceKey)) {
        return ignoreDecision('STALE_EVENT', `Event came from retired source instance ${event.sourceInstanceId}`);
      }
      const currentInstance = this.sourceInstances[event.source];
      if (currentInstance !== event.sourceInstanceId) {
        if (currentInstance) this.retiredSourceInstances.add(`${event.source}:${currentInstance}`);
        this.sourceInstances[event.source] = event.sourceInstanceId;
        this.lastSequence[event.source] = undefined;
        if (this.retiredSourceInstances.size > 32) {
          const oldest = this.retiredSourceInstances.values().next().value;
          if (oldest !== undefined) this.retiredSourceInstances.delete(oldest);
        }
      }
    }
    if (event.originEventId && this.seenOriginIds.has(event.originEventId)) {
      return ignoreDecision('LOOP_SUPPRESSED', `Duplicate originEventId ${event.originEventId}`);
    }
    const last = this.lastSequence[event.source];
    if (last !== undefined && event.sequence <= last) {
      return ignoreDecision('STALE_EVENT', `Sequence ${event.sequence} is not newer than ${last}`);
    }
    if (event.originEventId) {
      this.rememberOriginId(event.originEventId);
    }

    if (event.field) {
      const direction = echoDirectionForSource(event.source);
      const marker = this.writeMarkers.get(direction)?.get(event.field);
      if (marker && sameSyncValue(marker.value, event.value)) {
        this.writeMarkers.get(direction)?.delete(event.field);
        if (!event.originEventId || !marker.originEventId || event.originEventId === marker.originEventId) {
          this.lastSequence[event.source] = event.sequence;
          return ignoreDecision('LOOP_SUPPRESSED', 'Value matches the last write issued toward this side');
        }
      } else if (marker) {
        // A different user value supersedes the pending outbound marker. Keeping
        // it would incorrectly suppress a later genuine edit back to the old
        // value as though it were the original DOM echo.
        this.writeMarkers.get(direction)?.delete(event.field);
      }
    }

    this.lastSequence[event.source] = event.sequence;
    return applyDecision();
  }

  markWrite(input: {
    direction: SyncDirection;
    field: FlowSyncField;
    value: unknown;
    sequence: number;
    originEventId?: string;
  }): void {
    const byField = this.writeMarkers.get(input.direction) ?? new Map<FlowSyncField, WriteMarker>();
    byField.set(input.field, {
      field: input.field,
      value: input.value,
      sequence: input.sequence,
      originEventId: input.originEventId,
    });
    this.writeMarkers.set(input.direction, byField);
  }

  resolveConflict(
    a: FlowSyncEvent,
    b: FlowSyncEvent,
  ): { winner: FlowSyncEvent; loser: FlowSyncEvent } {
    if (a.sequence !== b.sequence) {
      return a.sequence > b.sequence ? { winner: a, loser: b } : { winner: b, loser: a };
    }
    const aTime = Date.parse(a.timestamp);
    const bTime = Date.parse(b.timestamp);
    if (aTime !== bTime) {
      return aTime > bTime ? { winner: a, loser: b } : { winner: b, loser: a };
    }
    return a.source === 'FLOWGRAPH' ? { winner: a, loser: b } : { winner: b, loser: a };
  }

  private rememberOriginId(originEventId: string): void {
    if (this.seenOriginIds.size >= MAX_SEEN_ORIGIN_IDS) {
      const oldest = this.seenOriginIds.values().next().value;
      if (oldest !== undefined) this.seenOriginIds.delete(oldest);
    }
    this.seenOriginIds.add(originEventId);
  }
}

// Orchestration for two-way FlowGraph Studio <-> Google Flow sync.
//
// - Studio changes are validated against the active node capability, then
//   written to Flow (prompt debounced, settings immediate).
// - Flow DOM events flow through the conflict guard before Studio writes.
// - Preflight is fail-closed for Generate; missing UI controls surface
//   NO_UI_COUNTERPART as a warning for settings sync, but block Generate.
import type {
  FlowSyncEvent,
  FlowSyncErrorCode,
  FlowSyncField,
  SyncDecision,
} from './FlowSyncTypes';
import { applyDecision, ignoreDecision } from './FlowSyncTypes';
import {
  getSyncNodeCapability,
  isSyncFieldSupported,
  isSyncGenerationNode,
  modeForSyncNode,
  nonSyncNodeReason,
  validateSyncFieldValue,
} from './SyncCapabilityRegistry';
import type { SyncNodeKind } from './SyncCapabilityRegistry';
import { SyncConflictGuard, echoDirectionForSource } from './SyncConflictGuard';
import { SyncStateStore } from './SyncState';

export interface SyncWriteTarget {
  write(event: FlowSyncEvent): void;
}

export interface SyncClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const defaultSyncClock: SyncClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LocalChangeInput {
  nodeId: string;
  field: FlowSyncField;
  value: unknown;
}

export interface SyncPreflightInput {
  projectId: string;
  nodeKind: SyncNodeKind;
  values: Partial<Record<FlowSyncField, unknown>>;
  /** true only after the controller verified the Flow UI counterpart exists. */
  uiVerified?: boolean;
}

export interface PreflightCheck {
  id: string;
  status: 'pass' | 'fail' | 'warn';
  code?: FlowSyncErrorCode;
  message?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
  blocking: PreflightCheck[];
}

export class FlowSyncController {
  private readonly guard: SyncConflictGuard;
  private readonly state = new SyncStateStore();
  private readonly toFlow: SyncWriteTarget;
  private readonly toStudio: SyncWriteTarget;
  private readonly clock: SyncClock;
  private readonly promptDebounceMs: number;
  private sequence = 0;
  private promptTimer: unknown;
  private pendingPrompt: { nodeId: string; value: string } | undefined;

  constructor(options: {
    projectId: string;
    toFlow: SyncWriteTarget;
    toStudio: SyncWriteTarget;
    clock?: SyncClock;
    promptDebounceMs?: number;
  }) {
    this.guard = new SyncConflictGuard({ projectId: options.projectId });
    this.toFlow = options.toFlow;
    this.toStudio = options.toStudio;
    this.clock = options.clock ?? defaultSyncClock;
    this.promptDebounceMs = options.promptDebounceMs ?? 250;
  }

  get projectId(): string {
    return this.guard.expectedProjectId;
  }

  getActiveSnapshot() {
    return this.state.getActiveNode();
  }

  setActiveNode(nodeId: string, nodeKind: SyncNodeKind): SyncDecision {
    if (!isSyncGenerationNode(nodeKind)) {
      const { code, reason } = nonSyncNodeReason(nodeKind);
      return ignoreDecision(code, reason);
    }
    const mode = modeForSyncNode(nodeKind);
    if (!mode) return ignoreDecision('UNSUPPORTED_NODE', `No Flow mode mapping for ${nodeKind}`);
    this.cancelPendingPrompt();
    this.state.setActiveNode(nodeId, nodeKind, mode);
    this.writeToFlow({ field: 'mode', value: mode });
    return applyDecision();
  }

  clearActiveNode(): void {
    this.cancelPendingPrompt();
    this.state.clearActiveNode();
  }

  handleStudioChange(input: LocalChangeInput): SyncDecision {
    const active = this.state.getActiveNode();
    if (!active) return ignoreDecision('NO_ACTIVE_NODE', 'No active sync node');
    if (active.nodeId !== input.nodeId) {
      return ignoreDecision('STALE_EVENT', `Change targets node ${input.nodeId}, active node is ${active.nodeId}`);
    }
    if (!isSyncFieldSupported(active.nodeKind, input.field)) {
      return ignoreDecision(
        'UNSUPPORTED_FIELD',
        `${input.field} has no Flow counterpart for node kind ${active.nodeKind}`,
      );
    }
    const validation = validateSyncFieldValue(input.field, input.value);
    if (!validation.ok) {
      return ignoreDecision(validation.code, validation.reason);
    }
    if (input.field === 'prompt') {
      this.pendingPrompt = { nodeId: input.nodeId, value: input.value as string };
      this.cancelPendingPrompt({ keepValue: true });
      this.promptTimer = this.clock.schedule(() => {
        this.flushPrompt();
      }, this.promptDebounceMs);
      return applyDecision();
    }
    return this.writeToFlow({ field: input.field, value: input.value });
  }

  flushPrompt(): SyncDecision {
    const pending = this.pendingPrompt;
    this.cancelPendingPrompt();
    if (!pending) return ignoreDecision('NO_ACTIVE_NODE', 'No pending prompt to flush');
    return this.writeToFlow({ field: 'prompt', value: pending.value });
  }

  handleFlowEvent(event: FlowSyncEvent): SyncDecision {
    const decision = this.guard.decide(event);
    if (decision.action === 'ignore') return decision;
    if (!event.field) {
      return ignoreDecision('UNSUPPORTED_FIELD', 'Flow event carried no field');
    }
    const active = this.state.getActiveNode();
    if (!active) return ignoreDecision('NO_ACTIVE_NODE', 'No active sync node');
    const observedMode = active.fields.mode?.value;
    const modeScopedField = event.field !== 'mode'
      && event.field !== 'prompt'
      && event.field !== 'generationStatus'
      && event.field !== 'resultMedia';
    if (modeScopedField && observedMode && observedMode !== active.mode) {
      return ignoreDecision(
        'MODE_MISMATCH',
        `Ignoring ${event.field} from ${observedMode}; active node requires ${active.mode}`,
      );
    }
    if (!isSyncFieldSupported(active.nodeKind, event.field)) {
      return ignoreDecision('UNSUPPORTED_FIELD', `${event.field} is not syncable for ${active.nodeKind}`);
    }
    const validation = validateSyncFieldValue(event.field, event.value);
    if (!validation.ok) return ignoreDecision(validation.code, validation.reason);

    // Flow observes one shared composer and therefore has no FlowGraph node id.
    // Route every accepted reverse event to the single active sync target; never
    // let an absent/stale provider node id turn the update into a no-op in Studio.
    const targetedEvent: FlowSyncEvent = { ...event, nodeId: active.nodeId };
    this.state.applyRemote(targetedEvent);
    this.toStudio.write(targetedEvent);
    return applyDecision();
  }

  preflight(input: SyncPreflightInput): PreflightResult {
    const checks: PreflightCheck[] = [];
    const push = (check: PreflightCheck) => checks.push(check);

    push(
      input.projectId === this.projectId && input.projectId.length > 0
        ? { id: 'project', status: 'pass' }
        : { id: 'project', status: 'fail', code: 'PROJECT_MISMATCH', message: 'Active project mismatch' },
    );

    const capability = getSyncNodeCapability(input.nodeKind);
    push(
      capability
        ? { id: 'node', status: 'pass' }
        : { id: 'node', status: 'fail', code: 'UNSUPPORTED_NODE', message: `${input.nodeKind} cannot generate` },
    );
    if (capability) {
      const value = (field: FlowSyncField) => input.values[field];
      const has = (field: FlowSyncField, predicate: (v: unknown) => boolean) =>
        capability.fields.includes(field) && predicate(value(field));

      push(
        has('model', (v) => typeof v === 'string' && v.length > 0)
          ? { id: 'model', status: 'pass' }
          : { id: 'model', status: 'fail', code: 'PREFLIGHT_FAILED', message: 'Model is required' },
      );
      if (capability.fields.includes('aspectRatio')) {
        push(
          has('aspectRatio', (v) => typeof v === 'string' && v.length > 0)
            ? { id: 'aspectRatio', status: 'pass' }
            : { id: 'aspectRatio', status: 'fail', code: 'PREFLIGHT_FAILED', message: 'Aspect ratio is required' },
        );
      }
      if (capability.fields.includes('durationSeconds')) {
        push(
          has('durationSeconds', (v) => typeof v === 'number' && v > 0)
            ? { id: 'duration', status: 'pass' }
            : { id: 'duration', status: 'fail', code: 'PREFLIGHT_FAILED', message: 'Duration is required' },
        );
      }
      if (capability.fields.includes('startImage')) {
        push(
          has('startImage', (v) => typeof v === 'object' && v !== null && typeof (v as { mediaId?: unknown }).mediaId === 'string')
            ? { id: 'mediaBinding', status: 'pass' }
            : { id: 'mediaBinding', status: 'fail', code: 'PREFLIGHT_FAILED', message: 'Upstream image binding required' },
        );
      }
      if (capability.fields.includes('referenceMedia')) {
        push(
          has('referenceMedia', (v) => Array.isArray(v) && v.length > 0)
            ? { id: 'mediaBinding', status: 'pass' }
            : { id: 'mediaBinding', status: 'fail', code: 'PREFLIGHT_FAILED', message: 'At least one reference media required' },
        );
      }
      if (capability.fields.includes('prompt')) {
        push(
          has('prompt', (v) => typeof v === 'string' && v.trim().length > 0)
            ? { id: 'prompt', status: 'pass' }
            : { id: 'prompt', status: 'fail', code: 'PREFLIGHT_FAILED', message: 'Prompt is required' },
        );
      }
      push(
        input.uiVerified
          ? { id: 'uiVerified', status: 'pass' }
          : { id: 'uiVerified', status: 'warn', code: 'NO_UI_COUNTERPART', message: 'Flow UI counterpart not verified' },
      );
      push(
        input.uiVerified
          ? { id: 'generate', status: 'pass' }
          : { id: 'generate', status: 'fail', code: 'NO_UI_COUNTERPART', message: 'Generate blocked until Flow UI is verified' },
      );
    }

    const blocking = checks.filter((check) => check.status === 'fail');
    return { ok: blocking.length === 0, checks, blocking };
  }

  private writeToFlow(input: { field: FlowSyncField; value: unknown }): SyncDecision {
    const active = this.state.getActiveNode();
    if (!active) return ignoreDecision('NO_ACTIVE_NODE', 'No active sync node');
    const validation = validateSyncFieldValue(input.field, input.value);
    if (!validation.ok) return ignoreDecision(validation.code, validation.reason);

    const sequence = ++this.sequence;
    const originEventId = `studio-${input.field}-${sequence}`;
    const timestamp = new Date(this.clock.now()).toISOString();
    this.state.markPending(input.field, input.value, originEventId, timestamp);
    this.guard.markWrite({
      direction: echoDirectionForSource('GOOGLE_FLOW'),
      field: input.field,
      value: input.value,
      sequence,
      originEventId,
    });
    this.toFlow.write({
      syncId: originEventId,
      timestamp,
      source: 'FLOWGRAPH',
      projectId: this.projectId,
      nodeId: active.nodeId,
      field: input.field,
      value: input.value,
      sequence,
      originEventId,
    });
    this.state.markSynced(input.field, input.value, timestamp);
    return applyDecision();
  }

  private cancelPendingPrompt(options: { keepValue?: boolean } = {}): void {
    if (this.promptTimer !== undefined) {
      this.clock.cancel(this.promptTimer);
      this.promptTimer = undefined;
    }
    if (!options.keepValue) this.pendingPrompt = undefined;
  }
}

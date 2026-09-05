// Per-active-node sync state. Only ONE node is the active sync target at a
// time; switching nodes re-targets all writes and drops pending debounces.
import type { FlowSyncErrorCode, FlowSyncEvent, FlowSyncField, FlowSyncMode } from './FlowSyncTypes';
import type { SyncNodeKind } from './SyncCapabilityRegistry';

export type SyncFieldStatus = 'idle' | 'pending' | 'synced' | 'error';

export interface SyncFieldState {
  status: SyncFieldStatus;
  value?: unknown;
  originEventId?: string;
  updatedAt?: string;
  error?: FlowSyncErrorCode;
}

export interface SyncNodeState {
  nodeId: string;
  nodeKind: SyncNodeKind;
  mode: FlowSyncMode;
  fields: Partial<Record<FlowSyncField, SyncFieldState>>;
}

export class SyncStateStore {
  private active: SyncNodeState | undefined;

  setActiveNode(nodeId: string, nodeKind: SyncNodeKind, mode: FlowSyncMode): SyncNodeState {
    this.active = { nodeId, nodeKind, mode, fields: {} };
    return this.active;
  }

  clearActiveNode(): void {
    this.active = undefined;
  }

  getActiveNode(): SyncNodeState | undefined {
    return this.active;
  }

  isActiveNode(nodeId: string | undefined): boolean {
    return this.active !== undefined && this.active.nodeId === nodeId;
  }

  markPending(field: FlowSyncField, value: unknown, originEventId: string, timestamp: string): void {
    this.patch(field, { status: 'pending', value, originEventId, updatedAt: timestamp, error: undefined });
  }

  markSynced(field: FlowSyncField, value: unknown, timestamp: string): void {
    this.patch(field, { status: 'synced', value, updatedAt: timestamp, error: undefined });
  }

  markError(field: FlowSyncField, error: FlowSyncErrorCode, timestamp: string): void {
    this.patch(field, { status: 'error', error, updatedAt: timestamp });
  }

  applyRemote(event: FlowSyncEvent): void {
    if (!event.field) return;
    this.patch(event.field, {
      status: 'synced',
      value: event.value,
      originEventId: event.originEventId,
      updatedAt: event.timestamp,
      error: undefined,
    });
  }

  private patch(field: FlowSyncField, patchValue: SyncFieldState): void {
    if (!this.active) return;
    this.active.fields = { ...this.active.fields, [field]: patchValue };
  }
}

// FlowSync protocol types — pure data contracts shared by Studio, service worker,
// and the Google Flow content script. No chrome APIs, no DOM access, no secrets:
// sync events carry field values and ids only (never cookies/tokens/signed URLs).

export type FlowSyncSource = 'FLOWGRAPH' | 'GOOGLE_FLOW';

export type FlowSyncField =
  | 'prompt'
  | 'mode'
  | 'model'
  | 'aspectRatio'
  | 'durationSeconds'
  | 'seed'
  | 'targetResolution'
  | 'startImage'
  | 'endImage'
  | 'referenceMedia'
  | 'generationStatus'
  | 'resultMedia';

export type FlowSyncMode = 'IMAGE' | 'VIDEO';

export interface MediaBindingValue {
  mediaId: string;
}

export interface FlowSyncEvent {
  syncId: string;
  timestamp: string;
  source: FlowSyncSource;
  projectId: string;
  nodeId?: string;
  field?: FlowSyncField;
  value?: unknown;
  sequence: number;
  originEventId?: string;
  /** Identifies one producer lifecycle so sequence numbers may safely reset on reload. */
  sourceInstanceId?: string;
  /** True only for a trusted pointer/keyboard action observed on Google Flow. */
  userInitiated?: boolean;
}

/**
 * Only direct Flow user intent may mutate editable Studio configuration.
 * Provider lifecycle/result events are authoritative without a user gesture;
 * all other untrusted DOM observations are React/provider side effects.
 */
export function isAuthoritativeFlowToStudioEvent(event: FlowSyncEvent): boolean {
  if (event.source !== 'GOOGLE_FLOW') return false;
  return event.userInitiated === true
    || event.field === 'generationStatus'
    || event.field === 'resultMedia';
}

export type FlowSyncErrorCode =
  | 'PROJECT_MISMATCH'
  | 'MODE_MISMATCH'
  | 'STALE_EVENT'
  | 'LOOP_SUPPRESSED'
  | 'UNSUPPORTED_FIELD'
  | 'UNSUPPORTED_NODE'
  | 'NO_ACTIVE_NODE'
  | 'INVALID_VALUE'
  | 'INVALID_MODEL'
  | 'UNKNOWN_PROVIDER_MODEL'
  | 'PROJECT_REQUIRED'
  | 'UI_NOT_READY'
  | 'NO_UI_COUNTERPART'
  | 'PREFLIGHT_FAILED';

export type SyncDecisionAction = 'apply' | 'ignore';

export interface SyncDecision {
  action: SyncDecisionAction;
  code?: FlowSyncErrorCode;
  reason?: string;
}

export function applyDecision(): SyncDecision {
  return { action: 'apply' };
}

export function ignoreDecision(code: FlowSyncErrorCode, reason: string): SyncDecision {
  return { action: 'ignore', code, reason };
}

/** Structural equality for sync values (primitives plus small binding payloads). */
export function sameSyncValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

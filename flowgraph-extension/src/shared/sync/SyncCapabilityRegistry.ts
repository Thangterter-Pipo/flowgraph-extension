// Which generation nodes/fields have a real Google Flow UI counterpart.
// Prompt/download/note nodes are containers — they never become active sync nodes.
import type { FlowSyncErrorCode, FlowSyncField, FlowSyncMode } from './FlowSyncTypes';

export type SyncNodeKind =
  | 't2i'
  | 'i2v'
  | 't2v'
  | 'reference'
  | 'extend'
  | 'interpolation'
  | 'upscale'
  | 'prompt'
  | 'download'
  | 'note'
  | 'local';

export interface SyncNodeCapability {
  kind: SyncNodeKind;
  /** Composer mode that the Google Flow chip must be switched to. */
  mode: FlowSyncMode;
  fields: readonly FlowSyncField[];
}

export const SYNC_NODE_CAPABILITIES: Readonly<Record<string, SyncNodeCapability>> = {
  t2i: {
    kind: 't2i',
    mode: 'IMAGE',
    fields: ['prompt', 'model', 'aspectRatio', 'batchCount', 'seed', 'targetResolution'],
  },
  t2v: {
    kind: 't2v',
    mode: 'VIDEO',
    fields: ['prompt', 'model', 'aspectRatio', 'batchCount', 'durationSeconds', 'seed', 'targetResolution'],
  },
  i2v: {
    kind: 'i2v',
    mode: 'VIDEO',
    fields: ['prompt', 'model', 'aspectRatio', 'batchCount', 'durationSeconds', 'seed', 'startImage', 'endImage'],
  },
  reference: {
    kind: 'reference',
    mode: 'VIDEO',
    fields: ['prompt', 'model', 'aspectRatio', 'durationSeconds', 'referenceMedia'],
  },
  extend: {
    kind: 'extend',
    mode: 'VIDEO',
    fields: ['prompt', 'model', 'durationSeconds', 'seed'],
  },
  interpolation: {
    kind: 'interpolation',
    mode: 'VIDEO',
    fields: ['prompt', 'model', 'aspectRatio', 'startImage', 'endImage'],
  },
  upscale: {
    kind: 'upscale',
    mode: 'VIDEO',
    fields: ['model', 'targetResolution'],
  },
};

export const NON_SYNC_NODE_KINDS: readonly string[] = ['prompt', 'download', 'note', 'local'];

/** Convert Studio registry display labels to the exact labels shown by Flow UI. */
export function normalizeFlowUiModelLabel(value: string): string {
  const label = value.replace(/^[^A-Za-z0-9]+/u, '').replace('–', '-').trim();
  return label === 'Omni Flash' ? 'Omni 1.1 Flash' : label;
}

export function isSyncGenerationNode(nodeKind: string): boolean {
  return Object.prototype.hasOwnProperty.call(SYNC_NODE_CAPABILITIES, nodeKind);
}

export function getSyncNodeCapability(nodeKind: string): SyncNodeCapability | undefined {
  return SYNC_NODE_CAPABILITIES[nodeKind];
}

export function modeForSyncNode(nodeKind: string): FlowSyncMode | undefined {
  return SYNC_NODE_CAPABILITIES[nodeKind]?.mode;
}

export function isSyncFieldSupported(nodeKind: string, field: FlowSyncField): boolean {
  if (field === 'mode' || field === 'generationStatus' || field === 'resultMedia') {
    return isSyncGenerationNode(nodeKind);
  }
  return SYNC_NODE_CAPABILITIES[nodeKind]?.fields.includes(field) ?? false;
}

export function nonSyncNodeReason(nodeKind: string): { code: FlowSyncErrorCode; reason: string } {
  return {
    code: 'UNSUPPORTED_NODE',
    reason: `Node kind "${nodeKind}" has no active Google Flow counterpart`,
  };
}

export function validateSyncFieldValue(
  field: FlowSyncField,
  value: unknown,
): { ok: true } | { ok: false; code: FlowSyncErrorCode; reason: string } {
  const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const isMediaBinding = (v: unknown): v is { mediaId: string } =>
    typeof v === 'object' && v !== null && isNonEmptyString((v as { mediaId?: unknown }).mediaId);

  switch (field) {
    case 'prompt':
      return typeof value === 'string'
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: 'prompt must be a string' };
    case 'mode':
      return value === 'IMAGE' || value === 'VIDEO'
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: 'mode must be IMAGE or VIDEO' };
    case 'model':
    case 'aspectRatio':
    case 'batchCount':
    case 'targetResolution':
      return isNonEmptyString(value)
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: `${field} must be a non-empty string` };
    case 'durationSeconds':
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: 'durationSeconds must be a positive number' };
    case 'seed':
      return typeof value === 'number' && Number.isInteger(value)
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: 'seed must be an integer' };
    case 'startImage':
    case 'endImage':
      return isMediaBinding(value)
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: `${field} requires mediaId` };
    case 'referenceMedia':
      return Array.isArray(value) && value.every(isMediaBinding)
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: 'referenceMedia requires a list of mediaId bindings' };
    case 'generationStatus':
      return typeof value === 'object' && value !== null && isNonEmptyString((value as { status?: unknown }).status)
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: 'generationStatus requires a status value' };
    case 'resultMedia':
      return isMediaBinding(value)
        ? { ok: true }
        : { ok: false, code: 'INVALID_VALUE', reason: 'resultMedia requires mediaId' };
  }
}

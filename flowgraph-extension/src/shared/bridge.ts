// FlowGraph bridge protocol — typed messages between React UI, service worker, and Flow content script.
// Security rule: raw cookies, OAuth bearer tokens and reCAPTCHA tokens NEVER cross this boundary
// into the React UI. The service worker holds the bearer token in memory only; the content script
// receives it transiently per request from the service worker (never from the UI) and the UI only
// ever receives sanitized state (names, ids, statuses, error codes).

export const BRIDGE_PREFIX = 'FLOWGRAPH_' as const;
import { reportDiagnostic } from './devDiagnostics';

/** Pre-arranged correlation ids for one-shot UI → SW requests. */
export const PRE_SIGNED_REQUEST_ID = 'ui:sw:request';

export type RequestType =
  | 'FLOWGRAPH_ACCOUNT_STATUS'
  | 'FLOWGRAPH_FLOW_STATUS'
  | 'FLOWGRAPH_PROJECT_LIST'
  | 'FLOWGRAPH_PROJECT_CREATE'
  | 'FLOWGRAPH_PROJECT_SELECT'
  | 'FLOWGRAPH_MEDIA_UPLOAD'
  | 'FLOWGRAPH_GENERATE'
  | 'FLOWGRAPH_ABORT_GENERATE'
  | 'FLOWGRAPH_GENERATE_PROGRESS'
  | 'FLOWGRAPH_MEDIA_STATUS'
  | 'FLOWGRAPH_MEDIA_DOWNLOAD'
  | 'FLOWGRAPH_CANCEL'
  | 'FLOWGRAPH_PROXY_FETCH'
  | 'FLOWGRAPH_CREDITS'
  | 'FLOWGRAPH_EVENT'
  | 'GET_FX_SESSION'
  | 'RESOLVE_MEDIA_URL'
  | 'FLOWGRAPH_UI_GENERATE'
  // Realtime Flow ↔ Studio sync writers/events. The service worker forwards
  // writers to the Google Flow content script; DOM observers reply with
  // FLOWGRAPH_SYNC_EVENT / FLOWGRAPH_SYNC_STATE.
  | 'FLOWGRAPH_SYNC_SET_PROMPT'
  | 'FLOWGRAPH_SYNC_SET_MODE'
  | 'FLOWGRAPH_SYNC_SET_MODEL'
  | 'FLOWGRAPH_SYNC_SET_ASPECT_RATIO'
  | 'FLOWGRAPH_SYNC_SET_BATCH'
  | 'FLOWGRAPH_SYNC_SET_BATCH_COUNT'
  | 'FLOWGRAPH_SYNC_SET_DURATION'
  | 'FLOWGRAPH_SYNC_SET_SEED'
  | 'FLOWGRAPH_SYNC_SET_RESOLUTION'
  | 'FLOWGRAPH_SYNC_BIND_MEDIA'
  | 'FLOWGRAPH_SYNC_START_FRAME'
  | 'FLOWGRAPH_SYNC_END_FRAME'
  | 'FLOWGRAPH_SYNC_REFERENCE_MEDIA'
  | 'FLOWGRAPH_SYNC_GENERATE'
  | 'FLOWGRAPH_SYNC_CANCEL'
  | 'FLOWGRAPH_SYNC_EVENT'
  | 'FLOWGRAPH_SYNC_STATE';

export function isRequestType(value: string): value is RequestType {
  return value.startsWith(BRIDGE_PREFIX) || value === 'GET_FX_SESSION' || value === 'RESOLVE_MEDIA_URL';
}

export interface BridgeRequest {
  type: RequestType;
  requestId: string;
  payload?: unknown;
}

export interface BridgeResponse<T = unknown> {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: BridgeError;
}

export interface BridgeError {
  code: string;
  message: string;
  retryable?: boolean;
  reason?: string;
}

const ERROR_REASON_RE = /^[A-Z][A-Z0-9_]{0,62}$/;

export function sanitizeErrorReason(reason: unknown): string | undefined {
  if (typeof reason !== 'string') return undefined;
  const trimmed = reason.trim();
  return ERROR_REASON_RE.test(trimmed) ? trimmed : undefined;
}

export function makeRequest<T = unknown>(type: RequestType, payload?: unknown, requestId = PRE_SIGNED_REQUEST_ID): BridgeRequest {
  return { type, requestId, payload };
}

export function makeResponse<T = unknown>(requestId: string, data?: T): BridgeResponse<T> {
  return { requestId, ok: true, data };
}

export function makeError<T = unknown>(requestId: string, code: string, message: string, retryable = false, reason?: string): BridgeResponse<T> {
  reportDiagnostic('RPC_FAILED');
  const safeReason = sanitizeErrorReason(reason);
  return { requestId, ok: false, error: { code, message, retryable, ...(safeReason ? { reason: safeReason } : {}) } };
}

export function normalizeError(error: unknown): BridgeError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const candidate = error as { code: unknown; message: unknown; retryable?: unknown; reason?: unknown };
    const safeReason = sanitizeErrorReason(candidate.reason);
    return {
      code: String(candidate.code ?? 'UNKNOWN'),
      message: String(candidate.message ?? 'Unknown error'),
      retryable: Boolean(candidate.retryable),
      ...(safeReason ? { reason: safeReason } : {}),
    };
  }
  if (error instanceof Error) {
    const candidate = error as Error & { reason?: unknown };
    const safeReason = sanitizeErrorReason(candidate.reason);
    return {
      code: 'UNKNOWN',
      message: error.message,
      retryable: false,
      ...(safeReason ? { reason: safeReason } : {}),
    };
  }
  return { code: 'UNKNOWN', message: String(error), retryable: false };
}

export function timeoutable<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BridgeTimeoutError(ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class BridgeTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Bridge request timed out after ${ms}ms`);
    reportDiagnostic('RPC_FAILED');
    this.name = 'BridgeTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// State models
// ---------------------------------------------------------------------------

export type AccountConnectionState =
  | 'CHECKING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'SESSION_EXPIRED'
  | 'ERROR';

export interface AccountStatus {
  state: AccountConnectionState;
  email?: string;
  name?: string;
  expiresAt?: string;
  error?: string;
}

export type FlowConnectionState =
  | 'CHECKING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'PROJECT_REQUIRED'
  | 'READY'
  | 'ERROR';

export interface FlowStatus {
  state: FlowConnectionState;
  url?: string;
  title?: string;
  projectId?: string;
  error?: string;
}

export interface ProjectInfo {
  projectId: string;
  projectTitle: string;
  creationTime?: string;
}

export interface ProjectListData {
  projects: ProjectInfo[];
  source: 'runtime' | 'fallback' | 'flow-dom';
  partial?: boolean;
  error?: string;
}

export interface ProjectCreateData {
  projectId: string;
  projectTitle: string;
}

export interface CreditsData {
  credits?: number;
  userPaygateTier?: string;
  serviceTier?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Media payloads (normalized)
// ---------------------------------------------------------------------------

export interface NormalizedMediaRef {
  mediaId: string;
  type: 'IMAGE' | 'VIDEO';
  projectId: string;
  workflowId?: string;
  mimeType?: string;
  fileName?: string;
  /** Transient signed CDN URL. Never persisted. */
  previewUrl?: string;
  /**
   * Set when the service worker confirmed the asset finished rendering directly
   * on the signed-in Google Flow UI (a new media tile appeared and its id was
   * recovered). The legacy aisandbox-pa bearer status API is dead for migrated
   * flow.google accounts, so video executors use this to skip bearer polling;
   * the download step re-resolves the URL from the page when previewUrl is empty.
   */
  completedViaUi?: boolean;
}

export interface MediaUploadPayload {
  projectId: string;
  imageBytesBase64: string;
  mimeType: string;
  fileName: string;
}

export interface GeneratePayload {
  kind: 't2i' | 'i2v' | 't2v' | 'extend' | 'interpolation' | 'reference' | 'upscale' | 'imageUpscale' | 'videoUpscale';
  projectId: string;
  /** Filled by the SW after acquiring a fresh reCAPTCHA token — never sent by UI. */
  recaptchaToken?: string;
  prompt?: string;
  modelKey: string;
  /** Exact human-readable model label expected in the Google Flow UI. */
  modelLabel?: string;
  mode?: string; // "Extend Forward" | "Edit Video"
  aspectRatio?: string;
  seed?: number;
  imageRefs?: Array<{ mediaId: string; imageUsageType?: string }>;
  startImage?: { mediaId: string };
  endImage?: { mediaId: string };
  videoInput?: { mediaId: string };
  targetResolution?: string;
  durationSeconds?: number;
  /** Requested provider batch size. Runtime still exposes the primary media output. */
  batchCount?: number;
}

export interface MediaStatusPayload {
  projectId: string;
  mediaId: string;
  /** Exact-ID playback recovery. Passive unless playbackRefresh is explicitly true. */
  playbackRecovery?: boolean;
  /** Explicit user-intent refresh for the exact VIDEO source; may drive Flow's own download UI but must not save a duplicate. */
  playbackRefresh?: boolean;
}

export interface MediaStatusData {
  status: 'ACTIVE' | 'SUCCESSFUL' | 'FAILED' | 'CANCELED' | 'UNKNOWN';
  progress?: number;
  remainingCredits?: number;
  errorMessage?: string;
  media?: NormalizedMediaRef;
}

export interface MediaDownloadPayload {
  mediaId: string;
  projectId: string;
  fileName?: string;
  /** Media kind so the worker can pick the right resolve strategy + file extension. */
  mediaType?: 'IMAGE' | 'VIDEO';
  /** Optional pre-resolved CDN URL, otherwise the content script resolves it. */
  url?: string;
}

export interface MediaDownloadData {
  ok: boolean;
  downloadId?: number;
  filename?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Event messages (runtime → UI push)
// ---------------------------------------------------------------------------

export interface RuntimeEvent {
  type: 'FLOWGRAPH_EVENT';
  runId: string;
  kind: 'node:status' | 'node:result' | 'run:state' | 'run:error';
  nodeId?: string;
  status?: string;
  result?: NormalizedMediaRef | Record<string, unknown>;
  error?: BridgeError;
}

/** Sanitized Flow UI sync state — verification flags only, never secrets. */
export interface SyncStateData {
  uiVerified: boolean;
}

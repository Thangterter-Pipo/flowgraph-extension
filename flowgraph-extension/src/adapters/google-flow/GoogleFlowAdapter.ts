// GoogleFlowAdapter (FG-0501) — normalized provider boundary for the runtime.
// The runtime never sees raw Google request shapes: every call here builds a
// normalized payload, sends it over the bridge to the service worker (which owns
// secrets), and returns normalized MediaRef / status objects.
import {
  makeError,
  makeRequest,
  type AccountStatus,
  type BridgeResponse,
  type CreditsData,
  type FlowStatus,
  type GeneratePayload,
  type MediaStatusData,
  type MediaStatusPayload,
  type NormalizedMediaRef,
  type ProjectCreateData,
  type ProjectListData,
  type RequestType,
} from '../../shared/bridge';
import type { FlowSyncEvent } from '../../shared/sync/FlowSyncTypes';
import type { SyncStateData } from '../../shared/bridge';
import { DOWNLOAD_BRIDGE_CEILING_MS, GENERATE_BRIDGE_CEILING_MS } from '../../shared/timeouts';
import { raceWithSignal } from '../../runtime/ExecutionContext';
import { ABORT_GENERATE_TYPE, applyGenerateProgress } from '../../shared/generationAbort';

export type { AccountStatus, CreditsData, FlowStatus, GeneratePayload, NormalizedMediaRef, ProjectCreateData, ProjectListData };

export interface GenerateCallOptions {
  abortSignal?: AbortSignal;
  /** Early real provider media/job id. Never pass a graph nodeId here. */
  onMediaId?: (mediaId: string) => void;
}

export type GenerateAbort = AbortSignal | GenerateCallOptions;

export function resolveGenerateCall(abortOrOptions?: GenerateAbort): GenerateCallOptions {
  if (!abortOrOptions) return {};
  if (typeof AbortSignal !== 'undefined' && abortOrOptions instanceof AbortSignal) {
    return { abortSignal: abortOrOptions };
  }
  return abortOrOptions as GenerateCallOptions;
}

export interface GoogleFlowAdapter {
  /** Account + Flow + active project health check. */
  healthCheck(): Promise<{ account: AccountStatus; flow: FlowStatus; credits?: CreditsData }>;
  listProjects(): Promise<ProjectListData>;
  createProject(title: string): Promise<ProjectCreateData>;
  selectProject(projectId: string): Promise<{ projectId: string; selectedAt: string }>;
  uploadImage(payload: { projectId: string; imageBytesBase64: string; mimeType: string; fileName: string }): Promise<NormalizedMediaRef>;
  generate(payload: GeneratePayload, abortOrOptions?: GenerateAbort): Promise<NormalizedMediaRef>;
  waitForMedia(payload: MediaStatusPayload): Promise<MediaStatusData>;
  resolvePreviewUrl(mediaId: string, projectId: string): Promise<string | undefined>;
  downloadMedia(payload: { mediaId: string; projectId: string; fileName?: string; mediaType?: 'IMAGE' | 'VIDEO'; url?: string }): Promise<{ ok: boolean; downloadId?: number; filename?: string; error?: string }>;
  cancel(payload: { projectId: string; mediaId: string }): Promise<Record<string, unknown>>;
}

// The UI never sends secrets. The service worker holds them in memory.
export interface BridgeTransport {
  request<T = unknown>(type: RequestType, payload?: unknown, requestId?: string): Promise<BridgeResponse<T>>;
}

function timeout(source: () => Promise<unknown>, maxMs: number): Promise<unknown> {
  return Promise.race([
    source(),
    new Promise((_resolve, reject) => setTimeout(() => reject(makeBridgeError('TIMEOUT', `Provider request timed out`, true)), maxMs)),
  ]);
}

function makeBridgeError(code: string, message: string, retryable: boolean) {
  const error = new Error(message) as Error & { code: string; retryable: boolean };
  error.code = code;
  error.retryable = retryable;
  return error;
}

/** Real adapter driven by chrome.runtime messaging (works in the extension context). */
export class RealGoogleFlowAdapter implements GoogleFlowAdapter {
  private readonly transport: BridgeTransport;
  // ordinary bridge calls (status, credits, sync writes) should fail fast.
  private readonly requestTimeoutMs = 120_000;
  private readonly syncRequestTimeoutMs = 20_000;
  // A real UI generation is bounded by the worker's own submit-verify loop, media
  // wait, and video-tile editor recovery. Live run 54058dc8 proved a 300s ceiling
  // could fire *while the worker was still working*, which surfaced a healthy
  // in-progress generation as `PROVIDER_ERROR: Provider request timed out` on node
  // 2 and discarded the specific error the worker was about to raise. Generation
  // therefore gets its own ceiling, derived in shared/timeouts.ts so it always sits
  // above every worker-side deadline.
  private readonly generateTimeoutMs = GENERATE_BRIDGE_CEILING_MS;
  // Downloading a video reuses the same trusted-click resolve loop as generate,
  // so it needs its own ceiling too. The generic 120s default masked a healthy
  // but slow download as a generic TIMEOUT on live run 30c818fa.
  private readonly downloadTimeoutMs = DOWNLOAD_BRIDGE_CEILING_MS;

  constructor(transport?: BridgeTransport) {
    const inExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
    this.transport = transport ?? {
      request: <T>(type: RequestType, payload?: unknown, givenId?: string) => new Promise<BridgeResponse<T>>((resolve) => {
        if (!inExtension) {
          resolve(makeError(makeRequest<T>(type, payload).requestId, 'BRIDGE_UNAVAILABLE', 'FlowGraph đang chạy ở chế độ preview web. Hãy mở Sidepanel từ Chrome Extension để kết nối Google Flow và Project thật.'));
          return;
        }
        const requestId = givenId ?? crypto.randomUUID();
        const message = makeRequest(type, payload, requestId);
        try {
          chrome.runtime.sendMessage(message, (response: BridgeResponse<T>) => {
            if (chrome.runtime.lastError) {
              resolve(makeError(requestId, 'BRIDGE_UNAVAILABLE', chrome.runtime.lastError.message ?? 'Service worker not reachable'));
              return;
            }
            resolve(response ?? makeError(requestId, 'BRIDGE_UNAVAILABLE', 'No response from service worker'));
          });
        } catch {
          resolve(makeError(requestId, 'BRIDGE_UNAVAILABLE', 'Service worker message send failed'));
        }
      }),
    };
  }

  private async call<T>(type: RequestType, payload?: unknown, maxMs = this.requestTimeoutMs, abortSignal?: AbortSignal): Promise<T> {
    const work = timeout(() => this.transport.request<T>(type, payload), maxMs);
    const response = (await raceWithSignal(work, abortSignal)) as BridgeResponse<T>;
    if (!response) throw makeBridgeError('BRIDGE_UNAVAILABLE', 'No response from service worker.', true);
    if (!response.ok) throw makeBridgeError(response.error?.code ?? 'PROVIDER_ERROR', response.error?.message ?? 'Provider error', response.error?.retryable ?? false);
    return response.data as T;
  }

  async healthCheck() {
    const account = await this.call<AccountStatus>('FLOWGRAPH_ACCOUNT_STATUS');
    const flow = await this.call<FlowStatus>('FLOWGRAPH_FLOW_STATUS');
    const credits = account.state === 'CONNECTED'
      ? await this.call<CreditsData>('FLOWGRAPH_CREDITS').catch(() => undefined)
      : undefined;
    return { account, flow, credits };
  }

  listProjects() {
    return this.call<ProjectListData>('FLOWGRAPH_PROJECT_LIST');
  }

  createProject(title: string) {
    return this.call<ProjectCreateData>('FLOWGRAPH_PROJECT_CREATE', { projectTitle: title });
  }

  selectProject(projectId: string) {
    return this.call<{ projectId: string; selectedAt: string }>('FLOWGRAPH_PROJECT_SELECT', { projectId });
  }

  uploadImage(payload: { projectId: string; imageBytesBase64: string; mimeType: string; fileName: string }) {
    return this.call<NormalizedMediaRef>('FLOWGRAPH_MEDIA_UPLOAD', payload);
  }

  async generate(payload: GeneratePayload, abortOrOptions?: GenerateAbort) {
    const { abortSignal, onMediaId } = resolveGenerateCall(abortOrOptions);
    const requestId = crypto.randomUUID();
    const onProgress = (message: unknown) => applyGenerateProgress(message, requestId, onMediaId);
    const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
    if (runtime?.onMessage) runtime.onMessage.addListener(onProgress);
    const sendAbort = () => {
      void this.transport.request(ABORT_GENERATE_TYPE, { requestId });
    };
    if (abortSignal?.aborted) sendAbort();
    else abortSignal?.addEventListener('abort', sendAbort, { once: true });
    try {
      const work = timeout(() => this.transport.request('FLOWGRAPH_GENERATE', payload, requestId), this.generateTimeoutMs);
      const response = (await raceWithSignal(work, abortSignal)) as BridgeResponse<NormalizedMediaRef>;
      if (!response) throw makeBridgeError('BRIDGE_UNAVAILABLE', 'No response from service worker.', true);
      if (!response.ok) throw makeBridgeError(response.error?.code ?? 'PROVIDER_ERROR', response.error?.message ?? 'Provider error', response.error?.retryable ?? false);
      const ref = response.data as NormalizedMediaRef;
      if (ref?.mediaId) onMediaId?.(ref.mediaId);
      return ref;
    } finally {
      abortSignal?.removeEventListener('abort', sendAbort);
      runtime?.onMessage?.removeListener(onProgress);
    }
  }

  waitForMedia(payload: MediaStatusPayload) {
    return this.call<MediaStatusData>('FLOWGRAPH_MEDIA_STATUS', payload);
  }

  async resolvePreviewUrl(mediaId: string, projectId: string): Promise<string | undefined> {
    const status = await this.call<MediaStatusData>('FLOWGRAPH_MEDIA_STATUS', { mediaId, projectId });
    return status.media?.previewUrl;
  }

  async downloadMedia(payload: { mediaId: string; projectId: string; fileName?: string; mediaType?: 'IMAGE' | 'VIDEO'; url?: string }) {
    const result = await this.call<{ ok: boolean; downloadId?: number; filename?: string; error?: string }>(
      'FLOWGRAPH_MEDIA_DOWNLOAD',
      payload,
      this.downloadTimeoutMs,
    );
    if (!result.ok) throw makeBridgeError('MEDIA_FAILED', result.error ?? 'Download failed', false);
    return result;
  }

  cancel(payload: { projectId: string; mediaId: string }) {
    return this.call<Record<string, unknown>>('FLOWGRAPH_CANCEL', payload);
  }

  writeSync(event: FlowSyncEvent) {
    const typeByField: Partial<Record<Exclude<FlowSyncEvent['field'], undefined>, RequestType>> = {
      prompt: 'FLOWGRAPH_SYNC_SET_PROMPT',
      mode: 'FLOWGRAPH_SYNC_SET_MODE',
      model: 'FLOWGRAPH_SYNC_SET_MODEL',
      aspectRatio: 'FLOWGRAPH_SYNC_SET_ASPECT_RATIO',
      batchCount: 'FLOWGRAPH_SYNC_SET_BATCH',
      durationSeconds: 'FLOWGRAPH_SYNC_SET_DURATION',
      seed: 'FLOWGRAPH_SYNC_SET_SEED',
      targetResolution: 'FLOWGRAPH_SYNC_SET_RESOLUTION',
      startImage: 'FLOWGRAPH_SYNC_START_FRAME',
      endImage: 'FLOWGRAPH_SYNC_END_FRAME',
      referenceMedia: 'FLOWGRAPH_SYNC_REFERENCE_MEDIA',
    };
    if (event.field === undefined) {
      return Promise.resolve({ ok: false, message: 'Sync event carried no field.' });
    }
    const type = typeByField[event.field];
    if (!type) return Promise.resolve({ ok: false, message: `No sync write for ${event.field}.` });
    return timeout(() => this.call<Record<string, unknown>>(type, {
      syncId: event.syncId,
      projectId: event.projectId,
      nodeId: event.nodeId,
      value: event.value,
      sequence: event.sequence,
      originEventId: event.originEventId,
    }), this.syncRequestTimeoutMs) as Promise<Record<string, unknown>>;
  }
}

// Static imports re-exported so executors can type payloads without bridge imports.
export { makeRequest as buildBridgeRequest } from '../../shared/bridge';
export type { MediaStatusData as BridgeMediaStatus } from '../../shared/bridge';

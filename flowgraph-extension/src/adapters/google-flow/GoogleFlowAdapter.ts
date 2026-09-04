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
import { GENERATE_BRIDGE_CEILING_MS } from '../../shared/timeouts';

export type { AccountStatus, CreditsData, FlowStatus, GeneratePayload, NormalizedMediaRef, ProjectCreateData, ProjectListData };

export interface GoogleFlowAdapter {
  /** Account + Flow + active project health check. */
  healthCheck(): Promise<{ account: AccountStatus; flow: FlowStatus; credits?: CreditsData }>;
  listProjects(): Promise<ProjectListData>;
  createProject(title: string): Promise<ProjectCreateData>;
  selectProject(projectId: string): Promise<{ projectId: string; selectedAt: string }>;
  uploadImage(payload: { projectId: string; imageBytesBase64: string; mimeType: string; fileName: string }): Promise<NormalizedMediaRef>;
  generate(payload: GeneratePayload): Promise<NormalizedMediaRef>;
  waitForMedia(payload: MediaStatusPayload): Promise<MediaStatusData>;
  resolvePreviewUrl(mediaId: string, projectId: string): Promise<string | undefined>;
  downloadMedia(payload: { mediaId: string; projectId: string; fileName?: string; mediaType?: 'IMAGE' | 'VIDEO'; url?: string }): Promise<{ ok: boolean; downloadId?: number; filename?: string; error?: string }>;
  cancel(payload: { projectId: string; mediaId: string }): Promise<Record<string, unknown>>;
}

// The UI never sends secrets. The service worker holds them in memory.
export interface BridgeTransport {
  request<T = unknown>(type: RequestType, payload?: unknown): Promise<BridgeResponse<T>>;
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
  // Ordinary bridge calls (status, credits, sync writes) should fail fast.
  private readonly requestTimeoutMs = 120_000;
  private readonly syncRequestTimeoutMs = 15_000;
  // A real UI generation is bounded by the worker's own submit-verify loop, media
  // wait, and video-tile editor recovery. Live run 54058dc8 proved a 300s ceiling
  // could fire *while the worker was still working*, which surfaced a healthy
  // in-progress generation as `PROVIDER_ERROR: Provider request timed out` on node
  // 2 and discarded the specific error the worker was about to raise. Generation
  // therefore gets its own ceiling, derived in shared/timeouts.ts so it always sits
  // above every worker-side deadline.
  private readonly generateTimeoutMs = GENERATE_BRIDGE_CEILING_MS;

  constructor(transport?: BridgeTransport) {
    const inExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
    this.transport = transport ?? {
      request: <T>(type: RequestType, payload?: unknown) => new Promise<BridgeResponse<T>>((resolve) => {
        if (!inExtension) {
          resolve(makeError(makeRequest<T>(type, payload).requestId, 'BRIDGE_UNAVAILABLE', 'FlowGraph must run inside Chrome with the extension loaded.'));
          return;
        }
        const requestId = crypto.randomUUID();
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

  private async call<T>(type: RequestType, payload?: unknown, maxMs = this.requestTimeoutMs): Promise<T> {
    const response = (await timeout(() => this.transport.request<T>(type, payload), maxMs)) as BridgeResponse<T>;
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

  generate(payload: GeneratePayload) {
    return this.call<NormalizedMediaRef>('FLOWGRAPH_GENERATE', payload, this.generateTimeoutMs);
  }

  waitForMedia(payload: MediaStatusPayload) {
    return this.call<MediaStatusData>('FLOWGRAPH_MEDIA_STATUS', payload);
  }

  async resolvePreviewUrl(mediaId: string, projectId: string): Promise<string | undefined> {
    const status = await this.call<MediaStatusData>('FLOWGRAPH_MEDIA_STATUS', { mediaId, projectId });
    return status.media?.previewUrl;
  }

  async downloadMedia(payload: { mediaId: string; projectId: string; fileName?: string; mediaType?: 'IMAGE' | 'VIDEO'; url?: string }) {
    const result = await this.call<{ ok: boolean; downloadId?: number; filename?: string; error?: string }>('FLOWGRAPH_MEDIA_DOWNLOAD', payload);
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

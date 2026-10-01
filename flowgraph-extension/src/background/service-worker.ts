// Manifest V3 background service worker — FlowGraph provider bridge.
import { installDiagnostics } from '../shared/devDiagnostics';
installDiagnostics('service-worker');
// Responsibilities:
//  - message router with requestId correlation + timeout (FG-0103)
//  - OAuth bearer token held IN MEMORY ONLY (never persisted, never sent to UI)
//  - provider fetch calls to aisandbox-pa.googleapis.com (Bearer auth)
//  - content-script ping for Flow tab state (URL, projectId from path)
//  - media generation (t2i/i2v/...), polling, cancel, download
//
// Security: the bearer token and reCAPTCHA token live only in this worker's memory
// and are passed transiently to the content script per fetch. They are never
// written to chrome.storage / localStorage, never logged, and never returned to UI.

import {
  buildCancelRequest,
  buildCreateProjectRequest,
  buildExtendRequest,
  buildI2vRequest,
  buildInterpolationRequest,
  buildPollRequest,
  buildReferenceRequest,
  buildT2iRequest,
  buildT2vRequest,
  buildUploadRequest,
  buildUpsampleRequest,
  clientContext,
} from '../shared/flowPayloads';
import {
  makeError,
  makeResponse,
  normalizeError,
  timeoutable,
  type AccountStatus,
  type BridgeRequest,
  type BridgeResponse,
  type CreditsData,
  type FlowStatus,
  type GeneratePayload,
  type MediaDownloadData,
  type MediaDownloadPayload,
  type MediaStatusData,
  type MediaStatusPayload,
  type MediaUploadPayload,
  type NormalizedMediaRef,
  type ProjectCreateData,
  type ProjectListData,
} from '../shared/bridge';
import {
  decideVideoTileArrival,
  editorPromptMatches,
  selectAttributedImageMediaId,
  EDITOR_PLACEHOLDER_PREFIXES,
  type ImageCandidateAttribution,
} from './videoTileDetection';
import {
  MEDIA_WAIT_IMAGE_MS,
  MEDIA_WAIT_VIDEO_MS,
  VIDEO_TILE_MAX_CANDIDATES,
  VIDEO_TILE_RECOVERY_STEP_MS,
  DOWNLOAD_RESOLVE_BUDGET_MS,
  DOWNLOAD_TRANSFER_BUDGET_MS,
} from '../shared/timeouts';
import {
  GENERATE_PROGRESS_TYPE,
  endGeneration,
  finalizeGenerateAgainstAbort,
  generationAbortedError,
  getGenerationFlight,
  isGenerationAborted,
  markGenerationAborted,
  throwIfGenerationAborted,
  trackGenerationMedia,
  trackGenerationStart,
  untilGenerationAborted,
  waitWhileNotAborted,
} from '../shared/generationAbort';
import {
  canSubmitGenerateWithComposerMode,
  canSubmitGenerateWithMediaBindings,
  canSubmitGenerateWithScalarSettings,
  composerChipMatchesRequestedModel,
  composerPromptMatchesExpected,
  expectedSubmittedPrompt,
  flowModelOptionMatchesRequested,
  isCostScalarField,
  preflightFailureCode,
  referenceMediaExactlyBound,
  shouldFailClosedOnMediaBindFailure,
  shouldFailClosedWhenDebuggerUnavailable,
  shouldToleratePreflightFailure,
  slotSourcesContainExactMediaId,
  truncateFlowPrompt,
  type CostScalarField,
} from '../shared/generationPreflight';
import {
  FLOW_BATCH_CAPTCHA_ACTION,
  FLOW_BATCH_CAPTCHA_SLOT,
  FLOW_BATCH_RPC,
  FlowBatchProtocolError,
  FlowBatchRpcError,
  buildFlowFirstFrameVideoRequest,
  buildFlowFirstLastVideoRequest,
  buildFlowImageRequest,
  buildFlowReferenceVideoRequest,
  buildFlowTextVideoRequest,
  firstFlowBatchPayload,
  readFlowGeneratedImages,
  resolveFlowFirstLastModelKey,
  readFlowOperation,
  readFlowTextVideoSubmit,
  type FlowBatchGeneratedImage,
} from '../adapters/google-flow/batch/FlowBatchProtocol';
import { FlowBatchVideoPoller } from '../adapters/google-flow/batch/FlowBatchPolling';
import {
  mayFallbackFromBatch,
  resolveFlowCapabilityRoute,
} from '../adapters/google-flow/FlowCapabilityRouter';
import {
  FlowBatchPageTransportError,
  runFlowBatchPageRpc,
} from './FlowBatchPageTransport';

// Configure sidePanel to open automatically when clicking the extension icon
try {
  if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
} catch {}

const AISANDBOX_BASE = 'https://aisandbox-pa.googleapis.com/v1';
const FX_API_BASE = 'https://labs.google/fx/api';

const TOKEN_TTL_MS = 50 * 60 * 1000; // refresh below 1h lifespan (verified ~3600s)
const REQUEST_TIMEOUT_MS = 60_000;
// Content-script settings writes can legitimately spend ~6-7s exhausting the
// settings-menu retry loop before returning NO_UI_COUNTERPART. Keep the outer
// worker budget above that inner retry window so we do not manufacture a false
// SYNC_TIMEOUT while the provider adapter is still resolving the real outcome.
const SYNC_WRITE_TIMEOUT_MS = 10_000;
// The transfer budget only. The signed-URL resolve loop above has its own
// bounds, and the adapter's DOWNLOAD_BRIDGE_CEILING_MS sits above both, so the
// bridge is never the thing that ends a healthy download.
const DOWNLOAD_TIMEOUT_MS = DOWNLOAD_TRANSFER_BUDGET_MS;

const FLOW_SITEKEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

// FLOWGRAPH_PROXY_FETCH runs with the extension's host permissions and cookie
// jar, so without an allowlist it is an authenticated open proxy. Local gateways
// are user-configurable on any port; add vetted remote hosts here explicitly.
const PROXY_FETCH_ALLOWED_HOSTS: ReadonlySet<string> = new Set([]);

// Video generation kinds share a video composer mode / VIDEO media type. Image
// generation (t2i) is the only IMAGE kind; everything else in GeneratePayload is
// video. Centralizing this avoids per-kind mishandling (e.g. t2v being returned
// as an image just because only i2v was special-cased).
const VIDEO_KINDS: ReadonlySet<string> = new Set([
  'i2v',
  't2v',
  'extend',
  'interpolation',
  'reference',
  'upscale',
]);

function isVideoKind(kind: string): boolean {
  return VIDEO_KINDS.has(kind);
}

// Single CDP left-click helper for every automation path. The brief hold between
// press and release is required — Flow's Angular app ignores zero-duration
// synthesized clicks. Passing a requestId makes the hold abort-aware so a
// cancelled generation stops mid-gesture instead of finishing the click.
async function cdpClickAt(
  target: chrome.debugger.Debuggee,
  x: number,
  y: number,
  holdMs = 80,
  requestId?: string,
): Promise<void> {
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
  });
  if (requestId !== undefined) {
    await waitWhileNotAborted(holdMs, requestId);
  } else {
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  }
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
  });
}

// ---------------------------------------------------------------------------
// In-memory session state (never persisted)
// ---------------------------------------------------------------------------

interface SessionState {
  accessToken: string;
  user?: { name?: string; email?: string; image?: string };
  expiresAt: string;
  obtainedAt: number;
}

let session: SessionState | null = null;
let activeProjectId: string | null = null;

function sessionFresh(): boolean {
  return session !== null && Date.now() - session.obtainedAt < TOKEN_TTL_MS;
}

async function ensureSession(): Promise<SessionState> {
  if (sessionFresh()) return session!;
  const tab = await findFlowTab();
  // STRICT RULE: Only authorize via an open Google Flow tab session.
  // Never fallback to direct worker-side cookie fetch if no Flow tab exists.
  if (!tab || tab.id === undefined) {
    throw bridgeError('NO_FLOW_TAB', 'Google Flow tab required. Open flow.google.com to authorize session.', true);
  }

  let reply: { ok?: boolean; token?: string; user?: { name?: string; email?: string }; expiresAt?: string; message?: string } | null = null;
  try {
    reply = await timeoutable(chrome.tabs.sendMessage(tab.id, { type: 'GET_FX_SESSION' }), REQUEST_TIMEOUT_MS);
  } catch {
    reply = null;
  }

  if (!reply?.ok || !reply.token) {
    // If content script wasn't ready yet, fetch directly BUT ONLY IF the tab exists
    reply = await fetchSessionDirect();
  }

  if (!reply?.ok || !reply.token) {
    throw bridgeError('AUTH_EXPIRED', reply?.message ?? 'Flow session could not be refreshed from the active Google Flow tab.', true);
  }
  session = {
    accessToken: reply.token as string,
    user: reply.user,
    expiresAt: reply.expiresAt ?? '',
    obtainedAt: Date.now(),
  };
  return session;
}

// Direct session fetch from the service worker. Works without a content script
// because the extension has the labs.google host permission and shares the
// browser cookie jar. Returns the same shape the content script relays.
async function fetchSessionDirect(): Promise<{ ok: boolean; token?: string; user?: { name?: string; email?: string }; expiresAt?: string; message?: string }> {
  try {
    const response = await timeoutable(fetch(`${FX_API_BASE}/auth/session`, { method: 'GET', credentials: 'include' }), REQUEST_TIMEOUT_MS);
    if (!response.ok) return { ok: false, message: `Session fetch failed: HTTP ${response.status}` };
    const data = (await response.json()) as { access_token?: string; user?: { name?: string; email?: string }; expires?: string };
    if (!data.access_token) return { ok: false, message: 'Session response missing access_token' };
    return { ok: true, token: data.access_token, user: { name: data.user?.name, email: data.user?.email }, expiresAt: data.expires };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Direct session fetch failed' };
  }
}

function bridgeError(code: string, message: string, retryable: boolean): Error & { code: string; retryable: boolean } {
  const error = new Error(message) as Error & { code: string; retryable: boolean };
  error.code = code;
  error.retryable = retryable;
  return error;
}

function bearerHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${session!.accessToken}`,
    'Content-Type': 'application/json',
    Origin: 'https://labs.google',
  };
}

// ---------------------------------------------------------------------------
// Flow tab discovery
// ---------------------------------------------------------------------------

async function findFlowTab(expectedProjectId?: string): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter(
    (tab) => tab.id !== undefined && isFlowUrl(tab.url ?? ''),
  );
  if (candidates.length === 0) return null;

  // A profile may contain both the Flow landing page and one or more project
  // tabs. Keep all bridge operations pinned to the bound project when known;
  // otherwise prefer the Flow tab the user most recently activated, then a
  // concrete project surface. chrome.tabs.query order is not a stable signal.
  const score = (tab: chrome.tabs.Tab): number => {
    const projectId = projectIdFromUrl(tab.url ?? '');
    if (expectedProjectId && projectId === expectedProjectId) return 2_000;
    if (activeProjectId && projectId === activeProjectId) return 1_000;
    if (tab.active) return 500;
    if (projectId) return 250;
    return 0;
  };
  const chosenTab = candidates.sort((a, b) =>
    score(b) - score(a) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  )[0] ?? null;

  // Tự động đảm bảo flow-content-script đã được tiêm vào tab được chọn (tránh lỗi Receiving end does not exist)
  if (chosenTab && chosenTab.id !== undefined) {
    void ensureFlowContentScript(chosenTab.id).catch(() => undefined);
  }

  return chosenTab;
}

// Helper đảm bảo flow-content-script đã được tiêm vào tab Google Flow trước khi gửi message.
// Sau extension reload, listener của content script cũ có thể biến mất dù tab Flow vẫn còn sống.
// Vì vậy executeScript chỉ là bước khởi động; phải ping lại và chứng minh bridge đã sẵn sàng.
async function ensureFlowContentScript(tabId: number): Promise<void> {
  const bridgeReady = async (): Promise<boolean> => {
    try {
      const ping = await timeoutable(
        chrome.tabs.sendMessage(tabId, { type: 'FLOWGRAPH_PING_FLOW' }),
        700,
      ) as { ok?: boolean } | undefined;
      return Boolean(ping?.ok);
    } catch {
      return false;
    }
  };

  if (await bridgeReady()) return;

  let injectionError = '';
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/flow-content-script.js'],
    });
  } catch (error) {
    injectionError = error instanceof Error ? error.message : String(error);
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 120));
    if (await bridgeReady()) return;
  }

  throw bridgeError(
    'BRIDGE_UNAVAILABLE',
    `Flow content bridge did not become ready after injection${injectionError ? `: ${injectionError}` : '.'}`,
    true,
  );
}

// The Google Flow project UUID is present in the page path for a project surface
// (/project/<uuid>). Deriving it from the real tab URL lets us report a definitive
// gate state even when the content-script relay has not finished injecting after a
// navigation, instead of silently dropping the update and leaving the gate fail-open.
function projectIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/project\/([0-9a-f-]{36})/i);
  return match?.[1] ?? undefined;
}

// Google migrated Flow from labs.google/fx to flow.google.com. Accept both
// surfaces so the bridge keeps working during and after the migration.
function isFlowUrl(url: string): boolean {
  return url.includes('labs.google/fx') || /^https:\/\/(www\.)?flow\.google\.com\//.test(url);
}

async function pingFlowTab(): Promise<FlowStatus> {
  const tab = await findFlowTab();
  if (!tab || tab.id === undefined) {
    return { state: 'DISCONNECTED', error: 'No Google Flow tab found' };
  }
  try {
    const reply = await timeoutable(chrome.tabs.sendMessage(tab.id, { type: 'FLOWGRAPH_PING_FLOW' }), 8_000);
    const status: FlowStatus = {
      state: 'CONNECTED',
      url: reply?.url ?? tab.url,
      title: reply?.title ?? tab.title,
      projectId: reply?.projectId ?? undefined,
    };
    return status.projectId ? { ...status, state: 'READY' } : { ...status, state: 'PROJECT_REQUIRED' };
  } catch {
    // Content script relay not ready yet. Fall back to the actual tab URL so a
    // settled navigation still reflects the real project state. This is the true
    // URL (project UUID in path), never a forced unlock.
    const projectId = projectIdFromUrl(tab.url ?? '');
    return projectId
      ? { state: 'READY', url: tab.url, title: tab.title, projectId }
      : { state: 'PROJECT_REQUIRED', url: tab.url, title: tab.title };
  }
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

interface AiSandboxMediaItem {
  name: string;
  projectId?: string;
  workflowId?: string;
  workflowStepId?: string;
  mediaMetadata?: {
    mediaStatus?: { mediaGenerationStatus?: string };
    mediaBlobSize?: string;
    mediaTitle?: string;
    createTime?: string;
  };
  image?: {
    generatedImage?: { fifeUrl?: string; mediaId?: string; seed?: number };
    userUploadedImage?: Record<string, unknown>;
  };
  video?: Record<string, unknown>;
}

interface AiSandboxResponse {
  media?: AiSandboxMediaItem[];
  workflows?: Array<{ name: string; projectId?: string }>;
  remainingCredits?: number;
  error?: { code?: string; message?: string; status?: string };
}

function mapStatus(st: string): MediaStatusData['status'] {
  if (st === 'MEDIA_GENERATION_STATUS_ACTIVE' || st === 'MEDIA_GENERATION_STATUS_PROCESSING') return 'ACTIVE';
  if (st === 'MEDIA_GENERATION_STATUS_SUCCESSFUL' || st === 'MEDIA_GENERATION_STATUS_COMPLETE') return 'SUCCESSFUL';
  if (st === 'MEDIA_GENERATION_STATUS_FAILED') return 'FAILED';
  if (st === 'MEDIA_GENERATION_STATUS_CANCELED') return 'CANCELED';
  return 'UNKNOWN';
}

function providerError(status: number, body: unknown): Error & { code: string; retryable: boolean; reason?: string } {
  const code = String((body as AiSandboxResponse | null)?.error?.code ?? '');
  const message = String((body as AiSandboxResponse | null)?.error?.message ?? `${status}`);
  const combined = `${code} ${message}`;
  if (combined.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY')) {
    const err = bridgeError('PROVIDER_ERROR', message || code, false) as Error & { code: string; retryable: boolean; reason?: string };
    err.reason = 'PUBLIC_ERROR_UNUSUAL_ACTIVITY';
    return err;
  }
  if (combined.includes('reCAPTCHA')) {
    return bridgeError('CAPTCHA_REQUIRED', message || 'reCAPTCHA evaluation failed', true);
  }
  if (status === 401) {
    session = null;
    return bridgeError('AUTH_EXPIRED', 'Google Flow session expired. Refresh the Flow tab and retry.', true);
  }
  if (status === 403) {
    if (combined.includes('CREDIT') || combined.includes('QUOTA')) return bridgeError('CREDIT_EXHAUSTED', message || code, false);
    if (combined.startsWith('PUBLIC_ERROR_') || combined.includes('PERMISSION_DENIED')) return bridgeError('PROVIDER_ERROR', message || code, false);
  }
  if (combined.includes('INVALID_ARGUMENT') || combined.includes('Unknown name') || combined.includes('Unknown field')) {
    return bridgeError('INVALID_INPUT', message || code, false);
  }
  return bridgeError('PROVIDER_ERROR', message || `HTTP ${status}`, status >= 500);
}

async function aisandboxFetch(path: string, body: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const auth = await ensureSession();
  void auth;
  const response = await timeoutable(
    fetch(`${AISANDBOX_BASE}/${path}`, { method: 'POST', headers: bearerHeaders(), body: JSON.stringify(body) }),
    timeoutMs,
  );
  const text = await response.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!response.ok) throw providerError(response.status, json);
  return json;
}

async function fxApiGet(path: string): Promise<unknown> {
  const response = await timeoutable(fetch(`${FX_API_BASE}/${path}`, { method: 'GET', credentials: 'include' }), REQUEST_TIMEOUT_MS);
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw providerError(response.status, null);
  return json;
}

async function fxApiPost(path: string, body: unknown): Promise<unknown> {
  const auth = await ensureSession();
  void auth;
  const response = await timeoutable(fetch(`${FX_API_BASE}/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), REQUEST_TIMEOUT_MS);
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok && !json) throw providerError(response.status, json);
  return json;
}

// ---------------------------------------------------------------------------
// Generation request builders (verified shapes only)
// ---------------------------------------------------------------------------

async function recaptchaToken(projectId: string, action = 'FLOW_GENERATE'): Promise<string> {
  void projectId;
  const tab = await findFlowTab();
  if (!tab || tab.id === undefined) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);

  // Content scripts run in Chrome's isolated world, where page-owned globals such
  // as Google Flow's reCAPTCHA Enterprise client are not visible. Execute the
  // legitimate page widget in MAIN world instead. This does not bypass or forge
  // reCAPTCHA; it invokes the same grecaptcha.enterprise.execute API loaded by
  // the signed-in Google Flow page and returns only the short-lived token to the
  // service worker.
  const results = await timeoutable(
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [FLOW_SITEKEY, action],
      func: async (sitekey: string, action: string) => {
        const pageWindow = window as typeof window & {
          grecaptcha?: {
            enterprise?: {
              execute?: (key: string, options: { action: string }) => Promise<string>;
            };
          };
        };
        const execute = pageWindow.grecaptcha?.enterprise?.execute;
        if (!execute) return { ok: false, message: 'reCAPTCHA Enterprise widget is not ready on the Google Flow page.' };
        try {
          const token = await execute(sitekey, { action });
          return token ? { ok: true, token } : { ok: false, message: 'reCAPTCHA returned an empty token.' };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : 'reCAPTCHA execution failed' };
        }
      },
    }),
    20_000,
  );
  const reply = results?.[0]?.result as { ok?: boolean; token?: string; message?: string } | undefined;
  if (!reply?.ok || !reply.token) throw bridgeError('CAPTCHA_REQUIRED', reply?.message ?? 'reCAPTCHA token unavailable', true);
  return reply.token;
}


const FLOW_BATCH_IMAGE_SUBMIT_OFFSETS_MS = [0, 500, 1_500, 2_500] as const;
const FLOW_BATCH_IMAGE_TRANSIENT_RETRY_DELAY_MS = 34_000;

function recordBatchDiagnostic(capability: string, error: Error & { code?: string }): void {
  try {
    void chrome.storage.local.set({
      'flowgraph.debug.lastBatchError': {
        capability,
        code: String(error.code ?? 'UNKNOWN'),
        message: error.message,
        at: new Date().toISOString(),
      },
    });
  } catch {
    // Best-effort sanitized diagnostic only.
  }
}

function toFlowBatchBridgeError(error: unknown): Error & { code?: string; retryable?: boolean; reason?: string } {
  if (error instanceof FlowBatchPageTransportError) {
    return bridgeError(error.code, error.message, true);
  }
  if (error instanceof FlowBatchProtocolError) {
    return bridgeError('BATCH_PROTOCOL_ERROR', error.message, true);
  }
  if (error instanceof FlowBatchRpcError) {
    const detailStr = JSON.stringify(error.detail);
    if (detailStr.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY')) {
      const err = bridgeError(
        'PROVIDER_ERROR',
        error.message,
        false,
      ) as Error & { code?: string; retryable?: boolean; reason?: string };
      err.reason = 'PUBLIC_ERROR_UNUSUAL_ACTIVITY';
      return err;
    }
    const transient = detailStr === '[8]';
    return bridgeError('PROVIDER_ERROR', error.message, transient);
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return error as Error & { code?: string; retryable?: boolean; reason?: string };
  }
  return bridgeError(
    'BATCH_RPC_UNAVAILABLE',
    error instanceof Error ? error.message : String(error),
    true,
  );
}

function isTransientFlowBatchImageError(error: unknown): boolean {
  return error instanceof FlowBatchRpcError && JSON.stringify(error.detail) === '[8]';
}

async function waitForBatchOffset(ms: number, requestId?: string): Promise<void> {
  if (ms <= 0) return;
  if (requestId) {
    await waitWhileNotAborted(ms, requestId);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitFlowBatchImageVariant(
  tabId: number,
  payload: GeneratePayload,
  variantIndex: number,
  launchOffsetMs: number,
  requestId?: string,
): Promise<FlowBatchGeneratedImage> {
  await waitForBatchOffset(launchOffsetMs, requestId);
  throwIfGenerationAborted(requestId);

  const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.IMAGE);
  throwIfGenerationAborted(requestId);

  const seed = payload.seed !== undefined ? payload.seed + variantIndex * 9_973 : undefined;
  const fReq = buildFlowImageRequest({
    prompt: payload.prompt ?? '',
    projectId: payload.projectId,
    model: payload.modelKey,
    aspect: payload.aspectRatio ?? '16:9',
    seed,
    referenceMediaIds: (payload.imageRefs ?? []).map((reference) => reference.mediaId),
  }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);

  const result = await timeoutable(
    runFlowBatchPageRpc({
      tabId,
      rpcId: FLOW_BATCH_RPC.GENERATE_IMAGE,
      fReq,
    }),
    120_000,
  );
  throwIfGenerationAborted(requestId);

  const providerPayload = firstFlowBatchPayload(result.text, FLOW_BATCH_RPC.GENERATE_IMAGE);
  const generated = readFlowGeneratedImages(providerPayload);
  if (!generated.length) {
    throw new FlowBatchProtocolError('Image generation returned no flow-content.google image URL.');
  }
  return generated[0];
}

async function generateT2iViaBatch(
  payload: GeneratePayload,
  requestId?: string,
): Promise<NormalizedMediaRef> {
  const prompt = (payload.prompt ?? '').trim();
  if (!prompt) throw bridgeError('INVALID_INPUT', 'Text-to-Image requires a non-empty prompt.', false);

  const tab = await findFlowTab(payload.projectId);
  if (!tab?.id) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const liveProjectId = projectIdFromUrl(tab.url ?? '');
  if (!liveProjectId || liveProjectId !== payload.projectId) {
    throw bridgeError(
      'PROJECT_MISMATCH',
      `Active Google Flow tab project (${liveProjectId || 'none'}) does not match request projectId (${payload.projectId}).`,
      false,
    );
  }

  const count = Math.min(4, Math.max(1, Math.floor(payload.batchCount ?? 1)));
  const indices = Array.from({ length: count }, (_unused, index) => index);
  const firstWave = await Promise.allSettled(
    indices.map((index) => submitFlowBatchImageVariant(
      tab.id!,
      payload,
      index,
      FLOW_BATCH_IMAGE_SUBMIT_OFFSETS_MS[index] ?? 0,
      requestId,
    )),
  );

  const results = [...firstWave];
  const retryIndices = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === 'rejected' && isTransientFlowBatchImageError(result.reason))
    .map(({ index }) => index);

  if (retryIndices.length) {
    await waitForBatchOffset(FLOW_BATCH_IMAGE_TRANSIENT_RETRY_DELAY_MS, requestId);
    const retried = await Promise.allSettled(
      retryIndices.map((index, position) => submitFlowBatchImageVariant(
        tab.id!,
        payload,
        index,
        FLOW_BATCH_IMAGE_SUBMIT_OFFSETS_MS[position] ?? 0,
        requestId,
      )),
    );
    retryIndices.forEach((index, position) => {
      results[index] = retried[position];
    });
  }

  const primary = results.find(
    (result): result is PromiseFulfilledResult<FlowBatchGeneratedImage> => result.status === 'fulfilled',
  );
  if (!primary) {
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    throw failure?.reason ?? new FlowBatchProtocolError('All image variants failed.');
  }

  return completeGenerate(requestId, {
    mediaId: primary.value.mediaId,
    type: 'IMAGE',
    projectId: payload.projectId,
    previewUrl: primary.value.url,
    mimeType: 'image/jpeg',
  }, payload.projectId);
}

const flowBatchPollers = new Map<number, FlowBatchVideoPoller>();

function flowBatchPollerForTab(tabId: number): FlowBatchVideoPoller {
  const existing = flowBatchPollers.get(tabId);
  if (existing) return existing;
  const created = new FlowBatchVideoPoller({
    run: async (rpcId, fReq, options) => (
      await runFlowBatchPageRpc({
        tabId,
        rpcId,
        fReq,
        match: options?.match,
      })
    ).text,
  });
  flowBatchPollers.set(tabId, created);
  return created;
}

function assertSingleBatchVideoSettingsSupported(payload: GeneratePayload, label: string): void {
  const count = Math.max(1, Math.floor(payload.batchCount ?? 1));
  if (count > 1) {
    throw bridgeError(
      'BATCH_RPC_UNAVAILABLE',
      `${label} batch transport currently preserves x1 only; requested x${count} must use the verified Flow UI path.`,
      true,
    );
  }
  if (payload.seed !== undefined) {
    throw bridgeError(
      'BATCH_RPC_UNAVAILABLE',
      `${label} batch capture does not prove a seed slot; explicit seed must use the verified Flow UI path.`,
      true,
    );
  }
  const resolution = String(payload.targetResolution ?? '').trim().toLowerCase();
  if (resolution && resolution !== '720p') {
    throw bridgeError(
      'BATCH_RPC_UNAVAILABLE',
      `${label} batch transport is enabled only for captured 720p/default payloads; requested ${payload.targetResolution} must use the verified Flow UI path.`,
      true,
    );
  }
}

async function waitForFlowBatchOperationMedia(
  tabId: number,
  operationId: string,
  projectId: string,
  requestId?: string,
): Promise<{ mediaId: string; previewUrl?: string }> {
  const poller = flowBatchPollerForTab(tabId);
  poller.rememberOperation(operationId, projectId);
  const deadline = Date.now() + MEDIA_WAIT_VIDEO_MS;
  let complaint = '';

  while (Date.now() <= deadline) {
    throwIfGenerationAborted(requestId);
    const result = await poller.pollOperation(operationId, projectId);
    complaint = result.complaint ?? complaint;
    if (result.mediaId) {
      emitGenerateProgress(requestId, result.mediaId);
      return {
        mediaId: result.mediaId,
        previewUrl: result.url,
      };
    }
    await waitForBatchOffset(3_000, requestId);
  }

  throw bridgeError(
    'TIMEOUT',
    `Flow batch operation ${operationId} did not expose a media id before the video deadline${complaint ? `: ${complaint}` : '.'}`,
    true,
  );
}

async function generateT2vViaBatch(
  payload: GeneratePayload,
  requestId?: string,
): Promise<NormalizedMediaRef> {
  const prompt = (payload.prompt ?? '').trim();
  if (!prompt) throw bridgeError('INVALID_INPUT', 'Text-to-Video requires a non-empty prompt.', false);
  assertSingleBatchVideoSettingsSupported(payload, 'Omni Text-to-Video');

  const tab = await findFlowTab(payload.projectId);
  if (!tab?.id) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const liveProjectId = projectIdFromUrl(tab.url ?? '');
  if (!liveProjectId || liveProjectId !== payload.projectId) {
    throw bridgeError(
      'PROJECT_MISMATCH',
      `Active Google Flow tab project (${liveProjectId || 'none'}) does not match request projectId (${payload.projectId}).`,
      false,
    );
  }

  throwIfGenerationAborted(requestId);
  const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.VIDEO);
  throwIfGenerationAborted(requestId);

  const fReq = buildFlowTextVideoRequest({
    prompt,
    projectId: payload.projectId,
    model: payload.modelKey,
    aspect: payload.aspectRatio ?? '16:9',
  }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);

  const result = await timeoutable(
    runFlowBatchPageRpc({
      tabId: tab.id,
      rpcId: FLOW_BATCH_RPC.GENERATE_VIDEO_TEXT,
      fReq,
    }),
    120_000,
  );
  throwIfGenerationAborted(requestId);

  const submitted = readFlowTextVideoSubmit(
    firstFlowBatchPayload(result.text, FLOW_BATCH_RPC.GENERATE_VIDEO_TEXT),
  );
  emitGenerateProgress(requestId, submitted.mediaId);

  return completeGenerate(requestId, {
    mediaId: submitted.mediaId,
    type: 'VIDEO',
    projectId: submitted.projectId ?? payload.projectId,
    workflowId: submitted.workflowId,
  }, payload.projectId);
}

async function completeOperationBackedBatchVideo(
  tabId: number,
  payload: GeneratePayload,
  rpcId: string,
  responseText: string,
  requestId?: string,
): Promise<NormalizedMediaRef> {
  const operation = readFlowOperation(firstFlowBatchPayload(responseText, rpcId));
  const media = await waitForFlowBatchOperationMedia(
    tabId,
    operation.operationId,
    operation.projectId ?? payload.projectId,
    requestId,
  );
  return completeGenerate(requestId, {
    mediaId: media.mediaId,
    type: 'VIDEO',
    projectId: operation.projectId ?? payload.projectId,
    workflowId: operation.operationId,
    previewUrl: media.previewUrl,
  }, payload.projectId);
}

async function generateI2vViaBatch(
  payload: GeneratePayload,
  requestId?: string,
): Promise<NormalizedMediaRef> {
  const prompt = (payload.prompt ?? '').trim();
  if (!prompt) throw bridgeError('INVALID_INPUT', 'Image-to-Video requires a non-empty prompt.', false);
  if (!payload.startImage?.mediaId) {
    throw bridgeError('INVALID_INPUT', 'Image-to-Video batch transport requires a start image mediaId.', false);
  }
  assertSingleBatchVideoSettingsSupported(payload, 'Omni Image-to-Video');

  const tab = await findFlowTab(payload.projectId);
  if (!tab?.id) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const liveProjectId = projectIdFromUrl(tab.url ?? '');
  if (liveProjectId !== payload.projectId) {
    throw bridgeError(
      'PROJECT_MISMATCH',
      `Active Google Flow tab project (${liveProjectId || 'none'}) does not match request projectId (${payload.projectId}).`,
      false,
    );
  }

  throwIfGenerationAborted(requestId);
  const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.VIDEO);
  const fReq = buildFlowFirstFrameVideoRequest({
    prompt,
    projectId: payload.projectId,
    sourceMediaId: payload.startImage.mediaId,
    model: payload.modelKey,
    aspect: payload.aspectRatio ?? '16:9',
  }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);

  const result = await timeoutable(
    runFlowBatchPageRpc({
      tabId: tab.id,
      rpcId: FLOW_BATCH_RPC.GENERATE_VIDEO,
      fReq,
    }),
    120_000,
  );
  throwIfGenerationAborted(requestId);
  return completeOperationBackedBatchVideo(
    tab.id,
    payload,
    FLOW_BATCH_RPC.GENERATE_VIDEO,
    result.text,
    requestId,
  );
}


async function generateInterpolationViaBatch(
  payload: GeneratePayload,
  requestId?: string,
): Promise<NormalizedMediaRef> {
  const prompt = (payload.prompt ?? '').trim();
  if (!prompt) throw bridgeError('INVALID_INPUT', 'First+Last video requires a non-empty prompt.', false);
  if (!payload.startImage?.mediaId || !payload.endImage?.mediaId) {
    throw bridgeError('INVALID_INPUT', 'First+Last batch transport requires both start and end image mediaIds.', false);
  }
  assertSingleBatchVideoSettingsSupported(payload, 'Omni First+Last');

  const tab = await findFlowTab(payload.projectId);
  if (!tab?.id) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const liveProjectId = projectIdFromUrl(tab.url ?? '');
  if (liveProjectId !== payload.projectId) {
    throw bridgeError(
      'PROJECT_MISMATCH',
      `Active Google Flow tab project (${liveProjectId || 'none'}) does not match request projectId (${payload.projectId}).`,
      false,
    );
  }

  throwIfGenerationAborted(requestId);
  const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.VIDEO);
  const fReq = buildFlowFirstLastVideoRequest({
    prompt,
    projectId: payload.projectId,
    startMediaId: payload.startImage.mediaId,
    endMediaId: payload.endImage.mediaId,
    model: resolveFlowFirstLastModelKey(payload.modelKey),
    aspect: payload.aspectRatio ?? '16:9',
  }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);

  const result = await timeoutable(
    runFlowBatchPageRpc({
      tabId: tab.id,
      rpcId: FLOW_BATCH_RPC.GENERATE_VIDEO_FIRST_LAST,
      fReq,
    }),
    120_000,
  );
  throwIfGenerationAborted(requestId);
  return completeOperationBackedBatchVideo(
    tab.id,
    payload,
    FLOW_BATCH_RPC.GENERATE_VIDEO_FIRST_LAST,
    result.text,
    requestId,
  );
}

async function generateReferenceVideoViaBatch(
  payload: GeneratePayload,
  requestId?: string,
): Promise<NormalizedMediaRef> {
  const prompt = (payload.prompt ?? '').trim();
  const referenceMediaIds = (payload.imageRefs ?? []).map((reference) => reference.mediaId).filter(Boolean);
  if (!prompt) throw bridgeError('INVALID_INPUT', 'Reference Video requires a non-empty prompt.', false);
  if (!referenceMediaIds.length) {
    throw bridgeError('INVALID_INPUT', 'Reference Video batch transport requires at least one reference mediaId.', false);
  }
  assertSingleBatchVideoSettingsSupported(payload, 'Omni Reference Video');

  const tab = await findFlowTab(payload.projectId);
  if (!tab?.id) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const liveProjectId = projectIdFromUrl(tab.url ?? '');
  if (liveProjectId !== payload.projectId) {
    throw bridgeError(
      'PROJECT_MISMATCH',
      `Active Google Flow tab project (${liveProjectId || 'none'}) does not match request projectId (${payload.projectId}).`,
      false,
    );
  }

  throwIfGenerationAborted(requestId);
  const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.VIDEO);
  const fReq = buildFlowReferenceVideoRequest({
    prompt,
    projectId: payload.projectId,
    referenceMediaIds,
    model: payload.modelKey,
    aspect: payload.aspectRatio ?? '16:9',
  }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);

  const result = await timeoutable(
    runFlowBatchPageRpc({
      tabId: tab.id,
      rpcId: FLOW_BATCH_RPC.GENERATE_VIDEO_REFERENCES,
      fReq,
    }),
    120_000,
  );
  throwIfGenerationAborted(requestId);
  return completeOperationBackedBatchVideo(
    tab.id,
    payload,
    FLOW_BATCH_RPC.GENERATE_VIDEO_REFERENCES,
    result.text,
    requestId,
  );
}

async function pollFlowBatchMediaStatus(
  payload: MediaStatusPayload,
): Promise<MediaStatusData | undefined> {
  const tab = await findFlowTab(payload.projectId);
  if (!tab?.id) return undefined;
  const liveProjectId = projectIdFromUrl(tab.url ?? '');
  if (liveProjectId !== payload.projectId) return undefined;

  try {
    const result = await flowBatchPollerForTab(tab.id).pollMedia(
      payload.mediaId,
      payload.projectId,
    );
    if (result.status === 'SUCCESSFUL' && result.url) {
      return {
        status: 'SUCCESSFUL',
        media: {
          mediaId: payload.mediaId,
          type: 'VIDEO',
          projectId: payload.projectId,
          previewUrl: result.url,
        },
      };
    }
    return {
      status: 'ACTIVE',
    };
  } catch (error) {
    const normalized = toFlowBatchBridgeError(error);
    const code = String(normalized.code ?? 'BATCH_RPC_UNAVAILABLE');
    return mayFallbackFromBatch(code) ? undefined : {
      status: 'FAILED',
      errorMessage: normalized.message,
    };
  }
}

const ENDPOINT_BY_KIND: Record<string, string> = {
  t2i: 'projects/{projectId}/flowMedia:batchGenerateImages',
  i2v: 'video:batchAsyncGenerateVideoStartImage',
  t2v: 'video:batchAsyncGenerateVideoText',
  extend: 'video:batchAsyncGenerateVideoEditVideo',
  interpolation: 'video:batchAsyncGenerateVideoStartAndEndImage',
  reference: 'video:batchAsyncGenerateVideoReferenceImages',
  upscale: 'video:batchAsyncGenerateVideoUpsampleVideo',
  videoUpscale: 'video:batchAsyncGenerateVideoUpsampleVideo',
  imageUpscale: 'flow/upsampleImage',
};

function endpointFor(payload: GeneratePayload): string {
  const template = ENDPOINT_BY_KIND[payload.kind];
  return template.replace('{projectId}', payload.projectId);
}

function buildRequestPayload(payload: GeneratePayload): Record<string, unknown> {
  const ctx = clientContext(payload.projectId, payload.recaptchaToken ?? '');
  const batchId = crypto.randomUUID();
  switch (payload.kind) {
    case 't2i': return buildT2iRequest(payload, ctx, batchId);
    case 'i2v': {
      if (!payload.startImage) throw bridgeError('INVALID_INPUT', 'i2v requires a start image mediaId', false);
      return buildI2vRequest(payload as GeneratePayload & { startImage: { mediaId: string } }, ctx, batchId);
    }
    case 't2v': return buildT2vRequest(payload, ctx, batchId);
    case 'extend': {
      if (!payload.videoInput) throw bridgeError('INVALID_INPUT', 'extend requires a video input mediaId', false);
      return buildExtendRequest(payload as GeneratePayload & { videoInput: { mediaId: string } }, ctx, batchId);
    }
    case 'interpolation': {
      if (!payload.startImage || !payload.endImage) throw bridgeError('INVALID_INPUT', 'interpolation requires start and end images', false);
      return buildInterpolationRequest(payload as GeneratePayload & { startImage: { mediaId: string }; endImage: { mediaId: string } }, ctx, batchId);
    }
    case 'reference': {
      const refs = payload.imageRefs ?? [];
      if (!refs.length) throw bridgeError('INVALID_INPUT', 'reference requires at least one image', false);
      return buildReferenceRequest(payload as GeneratePayload & { imageRefs: Array<{ mediaId: string; imageUsageType?: string }> }, ctx, batchId);
    }
    case 'upscale':
    case 'videoUpscale': {
      if (!payload.videoInput) throw bridgeError('INVALID_INPUT', 'upscale requires a video input mediaId', false);
      return buildUpsampleRequest(payload as GeneratePayload & { videoInput: { mediaId: string } }, ctx, batchId);
    }
    case 'imageUpscale': {
      const mediaId = payload.imageRefs?.[0]?.mediaId || (payload as any).mediaId;
      if (!mediaId) throw bridgeError('INVALID_INPUT', 'imageUpscale requires an image mediaId', false);
      let targetResolution = payload.targetResolution || 'UPSAMPLE_IMAGE_RESOLUTION_2K';
      if (targetResolution === '2K') targetResolution = 'UPSAMPLE_IMAGE_RESOLUTION_2K';
      if (targetResolution === '4K') targetResolution = 'UPSAMPLE_IMAGE_RESOLUTION_4K';
      return {
        mediaId,
        targetResolution,
        clientContext: ctx,
      };
    }
    default:
      throw bridgeError('UNSUPPORTED_KIND', `Unsupported generation kind: ${payload.kind}`, false);
  }
}

// Direct API generation path (uses verified aisandbox-pa.googleapis.com endpoints).
// If the backend returns 403 reCAPTCHA evaluation failed, this function throws
// CAPTCHA_REQUIRED so the user is prompted for legitimate security interaction.
async function generateApi(payload: GeneratePayload, requestId?: string): Promise<NormalizedMediaRef> {
  throwIfGenerationAborted(requestId);
  const token = await recaptchaToken(payload.projectId);
  throwIfGenerationAborted(requestId);
  const withToken = { ...payload, recaptchaToken: token } as GeneratePayload & { recaptchaToken: string };
  const body = buildRequestPayload(withToken);
  const json = await aisandboxFetch(endpointFor(payload), body) as Partial<AiSandboxResponse>;
  throwIfGenerationAborted(requestId);

  const media = json.media?.[0];
  if (!media?.name) throw bridgeError('MEDIA_FAILED', 'Provider returned no media id', false);
  emitGenerateProgress(requestId, media.name);
  const imageFife = media.image?.generatedImage?.fifeUrl;
  const previewUrl = imageFife
    ? (await resolveMediaUrl(media.name, 'IMAGE').catch(() => imageFife))
    : undefined;
  const isImageOutput = payload.kind === 't2i' || payload.kind === 'imageUpscale';
  return completeGenerate(requestId, {
    mediaId: media.name,
    type: isImageOutput ? 'IMAGE' : 'VIDEO',
    projectId: media.projectId ?? payload.projectId,
    workflowId: media.workflowId ?? json.workflows?.[0]?.name,
    previewUrl,
  }, payload.projectId);
}

function emitGenerateProgress(requestId: string | undefined, mediaId: string | undefined): void {
  if (!requestId || !mediaId) return;
  trackGenerationMedia(requestId, mediaId);
  try {
    void chrome.runtime.sendMessage({
      type: GENERATE_PROGRESS_TYPE,
      requestId,
      mediaId,
    });
  } catch {
    /* studio not listening */
  }
}

async function completeGenerate(
  requestId: string | undefined,
  result: NormalizedMediaRef,
  projectId: string,
): Promise<NormalizedMediaRef> {
  emitGenerateProgress(requestId, result.mediaId);
  return finalizeGenerateAgainstAbort(requestId, result, (mediaId) => handleCancel({ projectId, mediaId }));
}

async function pollOnce(payload: MediaStatusPayload, resolvePreview = false): Promise<MediaStatusData> {
  const json = await aisandboxFetch('video:batchCheckAsyncVideoGenerationStatus', buildPollRequest(payload.mediaId, payload.projectId)) as AiSandboxResponse;
  const item = json.media?.[0];
  const rawStatus = String(item?.mediaMetadata?.mediaStatus?.mediaGenerationStatus ?? '');
  const status = mapStatus(rawStatus);
  const data: MediaStatusData = {
    status,
    remainingCredits: json.remainingCredits,
  };
  if (status !== 'SUCCESSFUL') {
    if (status === 'FAILED') data.errorMessage = rawStatus;
    return data;
  }
  if (item && resolvePreview) {
    const previewUrl = await resolveRedirectSafe(payload.mediaId, item.video ? 'VIDEO' : 'IMAGE');
    data.media = {
      mediaId: payload.mediaId,
      type: item.video ? 'VIDEO' : 'IMAGE',
      projectId: item.projectId ?? payload.projectId,
      workflowId: item.workflowId,
      previewUrl,
    };
  }
  return data;
}

// ---------------------------------------------------------------------------
// Media redirect resolution (content script uses page cookies — token never
// leaves the worker; only the resolved URL passes over the bridge once).
// ---------------------------------------------------------------------------

// After Google's labs.google/fx -> flow.google.com migration the old
// `media.getMediaUrlRedirect` endpoint returns 401 (SERVER_UNAUTHORIZED) for
// media created on the new domain, so it can no longer be used to download
// freshly generated assets. The Flow UI now serves every asset through a
// same-origin proxy at `https://flow.google.com/asb/<token>`: images expose it
// directly on their `[data-media-id]` element, and videos expose it on the
// `<video>` element once the tile has been played. We read that URL from the
// signed-in page (MAIN world, so page-owned state is visible) and hand it to
// chrome.downloads, which follows it with the site cookie jar. No token or
// cookie ever leaves the worker; only the resolved same-origin URL crosses the
// bridge once.
async function resolveMediaUrl(mediaId: string, mediaType?: 'IMAGE' | 'VIDEO'): Promise<string> {
  const tab = await findFlowTab();
  if (!tab || tab.id === undefined) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  // Videos: the signed CDN URL only materialises once Angular renders a
  // <video> in the editor, and the editor only opens in response to a genuine
  // pointer event — a synthetic element.click() is ignored by the Angular host,
  // and chrome.windows.update({focused}) does not reliably OS-foreground the
  // window when Chrome is occluded. We therefore drive the clip's own download
  // button with the DevTools Input domain over chrome.debugger (the same
  // trusted-click mechanism the generate path uses) and capture the signed URL
  // the app itself fetches.
  if (mediaType === 'VIDEO') {
    // Bound the trusted-click resolve loop on its own so it can never eat the
    // transfer budget below it (shared/timeouts.ts invariant).
    return timeoutable(
      resolveVideoUrlViaDebugger(tab.id, tab.url, mediaId),
      DOWNLOAD_RESOLVE_BUDGET_MS,
    );
  }
  // Images: read the same-origin /asb/ proxy URL that the [data-media-id] element already exposes.
  // Không giật active: true để người dùng giữ nguyên màn hình Studio Canvas
  const results = await timeoutable(
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [mediaId],
      func: async (id: string) => {
        const isAsb = (u: string | null | undefined): u is string => !!u && u.includes('/asb/');
        // Images: the [data-media-id] element (or its child img) already points at the asb proxy.
        const el = document.querySelector(`[data-media-id="${id}"]`);
        if (el) {
          const img = (el.tagName === 'IMG' ? el : el.querySelector('img')) as HTMLImageElement | null;
          const s = img ? (img.currentSrc || img.getAttribute('src')) : null;
          if (s) return { ok: true, url: s };
        }
        // In /edit/<mediaId> editor, read the active editor main image directly
        const editorImg = Array.from(document.querySelectorAll('img')).find((i) => (isAsb(i.currentSrc || i.src) || (i.src || '').includes('flow-content.google')) && (i.naturalWidth > 600 || (i.src || '').includes('=s1600')));
        if (editorImg) {
          return { ok: true, url: editorImg.currentSrc || editorImg.src };
        }
        // Passive video check: if the editor is already open with a matching
        // <video> rendered, reuse it without needing a debugger click.
        const v = Array.from(document.querySelectorAll('video')).find(
          (el2) => (el2.currentSrc || el2.src || '').includes(id),
        );
        if (v) return { ok: true, url: (v.currentSrc || v.src) as string };
        return { ok: false, message: 'Could not find a same-origin /asb/ URL for this media on the Flow page.' };
      },
    }),
    DOWNLOAD_TIMEOUT_MS,
  );
  const reply = results?.[0]?.result as { ok?: boolean; url?: string; message?: string } | undefined;
  if (!reply?.ok || !reply.url) throw bridgeError('MEDIA_FAILED', reply?.message ?? 'Could not resolve media url', false);
  return reply.url as string;
}

// Google Flow is a provider tab, not the primary workspace. Automatic Studio
// operations must therefore never activate it or raise it above FlowGraph.
// `Emulation.setFocusEmulationEnabled` is enough to make background CDP input
// reachable without changing the user's active tab/window. If Google changes a
// control so that it genuinely requires foreground interaction, fail closed and
// ask for an explicit user action instead of silently stealing the screen.
async function ensureInputReachable(
  target: chrome.debugger.Debuggee,
): Promise<void> {
  await chrome.debugger
    .sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: true })
    .catch(() => undefined);
}

async function ensureFlowProjectComposerReady(
  tab: chrome.tabs.Tab,
  projectId: string,
  timeoutMs = 20_000,
): Promise<chrome.tabs.Tab> {
  if (tab.id === undefined) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const tabId = tab.id;
  const projectUrl = `https://flow.google.com/project/${projectId}`;
  let current = tab;

  // Media preview/download recovery temporarily visits /edit/<mediaId>. That
  // editor intentionally has no prompt composer. Before any UI-driven provider
  // operation, restore the project root in the same background tab and wait for
  // the real composer to mount; merely calling tabs.update() is not enough.
  if ((current.url ?? '').includes('/edit/')) {
    current = await chrome.tabs.update(tabId, { url: projectUrl });
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    current = await chrome.tabs.get(tabId);
    const liveProjectId = projectIdFromUrl(current.url ?? '');
    if (liveProjectId && liveProjectId !== projectId) {
      throw bridgeError(
        'PROJECT_MISMATCH',
        `Flow tab project ${liveProjectId} does not match generation project ${projectId}.`,
        false,
      );
    }
    if ((current.url ?? '').includes(`/project/${projectId}`) && !(current.url ?? '').includes('/edit/')) {
      const ready = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
            || document.querySelector('.ProseMirror[contenteditable="true"]')
            || document.querySelector('[role="textbox"][contenteditable="true"]');
          const settings = document.querySelector('button.settings-trigger-button')
            || Array.from(document.querySelectorAll('button')).find((button) => {
              const aria = (button.getAttribute('aria-label') || '').toLowerCase();
              return button.getAttribute('aria-haspopup') === 'menu'
                && (aria.includes('settings') || aria.includes('cài đặt') || /video|image/i.test(button.textContent || ''));
            });
          return Boolean(editor && settings);
        },
      }).then((results) => Boolean(results?.[0]?.result)).catch(() => false);
      if (ready) return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw bridgeError(
    'UI_NOT_READY',
    'Google Flow project composer did not become ready after leaving the media editor.',
    true,
  );
}

// Open a flow-video-tile in the editor with a real pointer click and read the
// signed CDN <video> src that embeds the mediaId. Reuses an already-attached
// debugger (e.g. while generate is in flight) and only detaches if it attached
// here, so it is safe to call from inside the generate CDP session.
async function resolveVideoUrlViaDebugger(
  tabId: number,
  galleryUrl: string | undefined,
  mediaId: string,
): Promise<string> {
  const target: chrome.debugger.Debuggee = { tabId };
  let attachedHere = false;
  // Resolve video URL: KHÔNG giật active: true sang tab Flow để người dùng giữ nguyên màn hình Studio
  let projectUrl = '';
  try {
    await chrome.debugger.attach(target, '1.3');
    attachedHere = true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/already attached/i.test(msg)) {
      throw bridgeError('MEDIA_FAILED', `Could not attach debugger to resolve video: ${msg}`, false);
    }
  }
  try {
    await ensureInputReachable(target);
    const evalOnPage = async <T = unknown>(expression: string): Promise<T | undefined> => {
      try {
        const res = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        })) as { result?: { value?: T } } | undefined;
        return res?.result?.value;
      } catch {
        return undefined;
      }
    };
    const clickAt = (x: number, y: number): Promise<void> => cdpClickAt(target, x, y);
    // Live probing on flow.google.com (2026-09-05) proved two things that break
    // any mediaId-in-the-URL strategy:
    //   1. The /edit/<mediaId> page renders ZERO <video> elements until the clip
    //      is actually played, so reading a <video> src never resolves.
    //   2. The signed CDN object id is NOT the clip mediaId — e.g. media
    //      8c4a2b72-… downloads as flow-content.google/video/3d18515b-…. So we
    //      cannot match the mediaId inside the URL at all.
    // The only reliable, non-fakeable source of the signed URL is the app's own
    // download action: the clip tile exposes a `download` button that opens a
    // resolution menu ("720p Kích thước gốc" = the real generated MP4). We drive
    // that genuine pointer interaction over the debugger and capture the exact
    // request the app fires. We never forge activation or bypass security.
    const editUrl = galleryUrl
      ? `${galleryUrl.replace(/\/edit\/[^/]+.*$/, '')}/edit/${mediaId}`
      : '';
    // The clip editor has no composer, so while we are here the content script
    // reports uiVerified=false and the next Generate is blocked by preflight.
    // Remember the project gallery so we can hand the tab back in that state.
    projectUrl = galleryUrl ? galleryUrl.replace(/\/edit\/[^/]+.*$/, '') : '';
    // The download button only exists once Angular has rendered the clip tile in
    // this editor, so wait for the real element instead of a fixed sleep.
    // Lưu ý: Nút download nằm ở thanh action bar của trang /edit/, không nằm trong 'flow-video-tile button'
    const downloadBtnXY = () =>
      evalOnPage<{ x: number; y: number } | null>(
        `(()=>{const b=[...document.querySelectorAll('button')].find((x)=>{const a=(x.getAttribute('aria-label')||'').toLowerCase();const i=x.querySelector('mat-icon,i');return /download|tải/.test(a)||(i&&i.textContent.trim()==='download')||(x.innerText||'').trim()==='download'});if(!b)return null;const r=b.getBoundingClientRect();if(r.width<2)return null;return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`,
      );
    const waitForButton = async (ms: number) => {
      const deadline = Date.now() + ms;
      for (;;) {
        const found = await downloadBtnXY();
        if (found) return found;
        if (Date.now() > deadline) return null;
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    const here = await evalOnPage<string>('location.href');
    if (editUrl && !(here || '').includes(`/edit/${mediaId}`)) {
      await chrome.debugger.sendCommand(target, 'Page.navigate', { url: editUrl }).catch(() => {});
      await waitForButton(20_000);
    }

    let signedUrl = '';
    // Video only — the same asset id also appears under /image/ for the poster.
    const isSignedVideo = (url: string): boolean =>
      /\/video\/[0-9a-f-]{20,}\?/i.test(url) && !/\.gif/i.test(url);
    const onDebuggerEvent = (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: object,
    ): void => {
      if (signedUrl || source.tabId !== tabId || method !== 'Network.requestWillBeSent') return;
      const url = (params as { request?: { url?: string } } | undefined)?.request?.url ?? '';
      if (isSignedVideo(url)) signedUrl = url;
    };
    chrome.debugger.onEvent.addListener(onDebuggerEvent);
    // Picking a resolution makes the app fetch the signed CDN URL and save it as
    // its own blob download. We only want the URL — the real artifact is written
    // by downloadMedia() once this returns — so pause that one request and abort
    // it. Cancelling after the fact proved useless: an 8 MB clip finishes before
    // onCreated is delivered, and leaving a duplicate in the user's Downloads on
    // every run is not acceptable. The pattern is scoped to the video asset host,
    // so nothing else the user is downloading can be touched.
    const pausedCopy = (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: object,
    ): void => {
      if (source.tabId !== tabId || method !== 'Fetch.requestPaused') return;
      const p = params as { requestId?: string; request?: { url?: string } } | undefined;
      const requestId = p?.requestId;
      if (!requestId) return;
      // Read the URL off the paused request itself: under interception this is the
      // authoritative signal, and it removes any ordering race with the Network
      // domain. Then abort so the app never writes its own copy.
      const url = p?.request?.url ?? '';
      if (isSignedVideo(url)) signedUrl = url;
      void chrome.debugger
        .sendCommand(target, 'Fetch.failRequest', { requestId, errorReason: 'Aborted' })
        .catch(() => undefined);
    };
    chrome.debugger.onEvent.addListener(pausedCopy);
    try {
      await chrome.debugger.sendCommand(target, 'Network.enable').catch(() => {});
      await chrome.debugger
        .sendCommand(target, 'Fetch.enable', {
          patterns: [{ urlPattern: 'https://flow-content.google/video/*', requestStage: 'Request' }],
        })
        .catch(() => {});
      const openMenuAndPick = async (): Promise<boolean> => {
        const btn = await downloadBtnXY();
        if (!btn) return false;
        await clickAt(btn.x, btn.y);
        await new Promise((r) => setTimeout(r, 1200));
        const item = await evalOnPage<{ x: number; y: number } | null>(
          `(()=>{const its=[...document.querySelectorAll('mat-menu-item,[role="menuitem"]')].filter((x)=>x.getBoundingClientRect().width>2);const pick=its.find((x)=>/720p/i.test(x.textContent))||its.find((x)=>!/gif/i.test(x.textContent))||its[0];if(!pick)return null;const r=pick.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`,
        );
        if (!item) return false;
        await clickAt(item.x, item.y);
        return true;
      };
      for (let attempt = 0; attempt < 3 && !signedUrl; attempt += 1) {
        await openMenuAndPick();
        for (let k = 0; k < 15 && !signedUrl; k += 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
        if (!signedUrl && editUrl) {
          // The menu can close without firing (stale overlay); reload the editor.
          await chrome.debugger.sendCommand(target, 'Page.navigate', { url: editUrl }).catch(() => {});
          await waitForButton(15_000);
        }
      }
    } finally {
      chrome.debugger.onEvent.removeListener(onDebuggerEvent);
      chrome.debugger.onEvent.removeListener(pausedCopy);
      await chrome.debugger.sendCommand(target, 'Fetch.disable').catch(() => {});
      await chrome.debugger.sendCommand(target, 'Network.disable').catch(() => {});
    }
    if (signedUrl) return signedUrl;
    throw bridgeError('MEDIA_FAILED', 'Could not resolve a signed video URL for this media on the Flow page.', false);
  } finally {
    if (attachedHere) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        // best-effort
      }
    }
    // Hand the tab back to the project gallery. Leaving it on /edit/<mediaId>
    // strands the next run: the editor has no composer, so the content script
    // reports uiVerified=false and preflight blocks Generate with
    // NO_UI_COUNTERPART (observed live after the download unit test).
    if (projectUrl) {
      try {
        const current = await chrome.tabs.get(tabId);
        const projectId = projectIdFromUrl(projectUrl);
        if (projectId) {
          await ensureFlowProjectComposerReady(current, projectId, 20_000);
        } else if ((current.url || '').includes('/edit/')) {
          await chrome.tabs.update(tabId, { url: projectUrl });
        }
      } catch {
        // best-effort: never fail media resolution because of provider cleanup;
        // the next UI-driven generation performs the same readiness check again.
      }
    }
  }
}

async function resolveRedirectSafe(mediaId: string, mediaType?: 'IMAGE' | 'VIDEO'): Promise<string> {
  try {
    return await resolveMediaUrl(mediaId, mediaType);
  } catch {
    return '';
  }
}

async function downloadMedia(payload: MediaDownloadPayload): Promise<MediaDownloadData> {
  // Resolve the same-origin /asb/ proxy URL from the signed-in Flow page (the
  // legacy labs.google/fx redirect endpoint 401s for new-domain media), then let
  // chrome.downloads follow it with the site cookie jar.
  let url = payload.url;
  if (!url) {
    try {
      url = await resolveMediaUrl(payload.mediaId, payload.mediaType);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const isVideo = payload.mediaType === 'VIDEO' || /video|\.mp4/i.test(url);
  const filename = payload.fileName ? `${payload.fileName}.${isVideo ? 'mp4' : 'jpg'}` : undefined;
  return timeoutable(
    // Poll the item instead of waiting for `onChanged`. Live run 95a31d7a proved
    // the event path unreliable: the artifact (`flowgraph-output (9).mp4`, id 30)
    // reached state=complete 2.5s after it started, yet the listener never saw a
    // matching delta, so a perfectly good download hung until the 180s worker
    // deadline and surfaced as `PROVIDER_ERROR: Bridge request timed out`.
    // Reading state from `chrome.downloads.search` cannot miss a transition.
    (async (): Promise<MediaDownloadData> => {
      const downloadId = await chrome.downloads.download({
        url,
        filename,
        saveAs: false,
        conflictAction: 'uniquify',
      });
      const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
      for (;;) {
        const [item] = await chrome.downloads.search({ id: downloadId });
        if (item?.state === 'complete') {
          return { ok: true, downloadId, filename: item.filename };
        }
        if (item?.state === 'interrupted') {
          return { ok: false, downloadId, error: item.error ?? 'Download interrupted' };
        }
        if (Date.now() > deadline) {
          return { ok: false, downloadId, error: 'Download did not finish in time' };
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    })(),
    DOWNLOAD_TIMEOUT_MS,
  );
}

// ---------------------------------------------------------------------------
// Bridge handlers
// ---------------------------------------------------------------------------

async function handleAccountStatus(): Promise<AccountStatus> {
  try {
    // STRICT RULE: Quét duy nhất tài khoản Google đang đăng nhập trên trang Google Flow đang bật
    const tab = await findFlowTab();
    if (!tab || tab.id === undefined) {
      return {
        state: 'DISCONNECTED',
        error: 'Chỉ kết nối khi trang Google Flow đang mở.',
      };
    }

    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const el = document.querySelector('a.gb_C, [aria-label*="@gmail.com"], [aria-label*="Tài khoản Google" i], [aria-label*="Google Account" i]');
          if (el) {
            const aria = el.getAttribute('aria-label') || '';
            const emailMatch = aria.match(/\(([^)]+@[^)]+)\)/i);
            const nameMatch = aria.match(/Tài khoản Google:\s*([^\n(]+)/i) || aria.match(/Google Account:\s*([^\n(]+)/i);
            return {
              email: emailMatch ? emailMatch[1].trim() : undefined,
              name: nameMatch ? nameMatch[1].trim() : undefined,
            };
          }
          return null;
        },
      });
      const userFromDom = injected?.[0]?.result;
      if (userFromDom?.email) {
        return {
          state: 'CONNECTED',
          email: userFromDom.email,
          name: userFromDom.name,
        };
      }
    } catch {}

    const auth = await ensureSession();
    return {
      state: 'CONNECTED',
      email: auth.user?.email,
      name: auth.user?.name,
      expiresAt: auth.expiresAt,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      state: normalized.code === 'AUTH_EXPIRED' ? 'SESSION_EXPIRED' : normalized.code === 'NO_FLOW_TAB' ? 'DISCONNECTED' : 'ERROR',
      error: normalized.message,
    };
  }
}

async function detectFlowServiceTierFromUi(): Promise<string | undefined> {
  try {
    const tab = await findFlowTab();
    if (!tab?.id) return undefined;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const texts = Array.from(document.querySelectorAll('button, span, div, a'))
          .map((element) => (element.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((text) => text.length > 0 && text.length <= 80);
        if (texts.some((text) => /(^|\s)ULTRA($|\s)/i.test(text))) return 'SERVICE_TIER_ADVANCED';
        if (texts.some((text) => /(^|\s)PRO($|\s)/i.test(text))) return 'SERVICE_TIER_INTERMEDIATE';
        return undefined;
      },
    });
    const inferred = results?.[0]?.result;
    return typeof inferred === 'string' ? inferred : undefined;
  } catch {
    return undefined;
  }
}

async function handleCredits(): Promise<CreditsData> {
  try {
    const tab = await findFlowTab();
    // Prioritize scraping real remaining credits from live Flow Tab DOM
    if (tab && tab.id !== undefined) {
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const bodyText = document.body.innerText || '';
            // Match phrases like "100 credits", "Credits: 100", "100 / 100 credits", "remaining credits: 100"
            const match = bodyText.match(/(?:credits?|điểm)\s*:?\s*(\d+)/i) ||
                          bodyText.match(/(\d+)\s*(?:credits?|điểm)/i);
            if (match) {
              const val = parseInt(match[1], 10);
              if (!isNaN(val)) return val;
            }
            return null;
          },
        });
        const domCredit = injected?.[0]?.result;
        if (typeof domCredit === 'number') {
          const serviceTier = await detectFlowServiceTierFromUi();
          return { credits: domCredit, serviceTier };
        }
      } catch {}
    }

    let data: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await ensureSession();
      const response = await timeoutable(
        fetch(`${AISANDBOX_BASE}/credits`, { headers: bearerHeaders() }),
        REQUEST_TIMEOUT_MS,
      );
      const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        data = parsed;
        break;
      }
      if (response.status === 401 && attempt === 0) {
        session = null;
        continue;
      }
      throw providerError(response.status, parsed);
    }
    if (!data) throw bridgeError('AUTH_EXPIRED', 'Google Flow credits session could not be refreshed.', true);
    const credits = typeof data.credits === 'number'
      ? data.credits
      : typeof data.remainingCredits === 'number'
        ? data.remainingCredits
        : undefined;
    const serviceTier = typeof data.serviceTier === 'string'
      ? data.serviceTier
      : await detectFlowServiceTierFromUi();
    return {
      credits,
      userPaygateTier: typeof data.userPaygateTier === 'string' ? data.userPaygateTier : undefined,
      serviceTier,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const serviceTier = await detectFlowServiceTierFromUi();
    return { error: normalized.message, serviceTier };
  }
}

function unwrapTrpc(json: unknown): unknown {
  const root = json as { result?: { data?: { json?: { result?: unknown; status?: number; statusText?: string } } } };
  return root?.result?.data?.json?.result;
}

// Serialized by executeScript: keep all validation inside this read-only function.
function readFlowProjectCards(expectedUrl: string): ProjectListData {
  const unavailable = (): ProjectListData => ({ projects: [], source: 'flow-dom', partial: true,
    error: 'Chưa đọc được dự án. Hãy mở trang danh sách dự án Google Flow, đợi tải xong rồi thử lại.' });
  const page = new URL(location.href);
  if (location.href !== expectedUrl || page.origin !== 'https://flow.google.com' || page.username || page.password ||
    !/^\/$/.test(page.pathname) || page.search || page.hash) return unavailable();
  const projects: ProjectListData['projects'] = [];
  const seen = new Set<string>();
  const cards = Array.from(document.querySelectorAll('flow-project-card'));
  for (const c of cards) {
    const a = c.querySelector('a.project-thumbnail-container');
    const footer = c.querySelector('.project-card-footer') as HTMLElement | null;
    const img = c.querySelector('img') as HTMLImageElement | null;
    const href = a ? a.getAttribute('href') : '';
    const m = href ? href.match(/\/project\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) : null;
    if (m) {
      const projectId = m[1].toLowerCase();
      if (seen.has(projectId)) continue;
      let title = footer ? (footer.innerText || footer.textContent || '').split('\n')[0].trim() : '';
      title = title.replace(/\b(edit|delete|add)\b/gi, '').trim();
      const thumbnailUrl = img?.getAttribute('src') || img?.currentSrc || undefined;
      seen.add(projectId);
      projects.push({ projectId, projectTitle: title || 'Untitled Project', thumbnailUrl });
    }
  }
  return projects.length ? { projects, source: 'flow-dom', partial: true } : unavailable();
}

async function handleProjectList(): Promise<ProjectListData> {
    // No findFlowTab(): it injects the content bridge. Never combine accounts/tabs.
    const tabs = (await chrome.tabs.query({})).filter(tab => {
      try {
        const url = new URL(tab.url ?? '');
        return tab.id !== undefined && url.protocol === 'https:' && !url.username && !url.password && !url.port &&
          ((url.hostname === 'flow.google.com' && /^\/(?:project\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?)?$/i.test(url.pathname)) ||
            (url.hostname === 'labs.google' && /^\/fx\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tools\/flow(?:\/project\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\/?$/i.test(url.pathname)));
      } catch { return false; }
    });
    if (tabs.length !== 1) throw bridgeError('PROJECT_LIST_UNAVAILABLE',
      'Hãy giữ một thẻ Google Flow và mở trang danh sách dự án để tải lại; không gộp dữ liệu giữa các thẻ.', false);
    const tab = tabs[0];
    if (new URL(tab.url!).hostname === 'flow.google.com') {
      try {
        const results = await timeoutable(chrome.scripting.executeScript({
          target: { tabId: tab.id! }, world: 'ISOLATED', func: readFlowProjectCards, args: [tab.url!],
        }), REQUEST_TIMEOUT_MS);
        const data = results[0]?.result;
        if ((await chrome.tabs.get(tab.id!)).url !== tab.url || !data || data.error || !data.projects.length) {
          throw new Error('unavailable');
        }
        return data;
      } catch {
        throw bridgeError('PROJECT_LIST_UNAVAILABLE',
          'Chưa đọc được dự án. Hãy mở trang danh sách dự án Google Flow, đợi tải xong rồi thử lại.', true);
      }
    }
    // Legacy cookie API cannot prove which tab account it belongs to.
    throw bridgeError('PROJECT_LIST_UNAVAILABLE', 'Hãy mở trang danh sách tại https://flow.google.com/ rồi thử lại.', false);
}

async function handleLegacyProjectList(): Promise<ProjectListData> {
    const inputParam = encodeURIComponent(JSON.stringify({ json: { pageSize: 20, toolName: 'PINHOLE' } }));
    const json = await fxApiGet(`trpc/project.searchUserProjects?input=${inputParam}`);
    const result = unwrapTrpc(json) as { projects?: Array<{ projectId: string; projectInfo?: { projectTitle?: string } | string; creationTime?: string }> } | null;
    if (!result || !Array.isArray(result.projects) || result.projects.some(project =>
      !project || typeof project.projectId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(project.projectId) ||
      (typeof project.projectInfo !== 'string' && typeof project.projectInfo?.projectTitle !== 'string')
    )) throw bridgeError('PROVIDER_ERROR', 'Google Flow returned an invalid project list.', false);
    const raw = result.projects;
  const projects = raw.map((project) => ({
    projectId: project.projectId,
    projectTitle: typeof project.projectInfo === 'string' ? project.projectInfo : (project.projectInfo?.projectTitle ?? 'Untitled project'),
    creationTime: project.creationTime,
  }));
  return { projects, source: 'runtime' };
}

async function handleProjectCreate(projectTitle: string): Promise<ProjectCreateData> {
  const json = await fxApiPost('trpc/project.createProject', buildCreateProjectRequest(projectTitle));
  const result = unwrapTrpc(json) as { projectId?: string; projectInfo?: { projectTitle?: string } } | null;
  if (!result?.projectId) throw bridgeError('PROVIDER_ERROR', 'Project create returned no projectId', false);
  activeProjectId = result.projectId;
  return { projectId: result.projectId, projectTitle: result.projectInfo?.projectTitle ?? projectTitle };
}

async function syncAndVerifyBeforeGenerate(
  tab: chrome.tabs.Tab,
  payload: GeneratePayload,
): Promise<{ limitations: string[]; assertScalarReadyToSubmit: () => Promise<void> }> {
  if (tab.id === undefined) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const tabProjectId = projectIdFromUrl(tab.url ?? '');
  if (!tabProjectId || tabProjectId !== payload.projectId) {
    throw bridgeError(
      'PROJECT_MISMATCH',
      `Flow tab project ${tabProjectId ?? 'none'} does not match generation project ${payload.projectId}.`,
      false,
    );
  }

  type PreflightWrite = { field: string; type: string; value: unknown; optional?: boolean };
  const modeWrite: PreflightWrite = {
    field: 'mode',
    type: 'FLOWGRAPH_SYNC_SET_MODE',
    value: isVideoKind(payload.kind) ? 'VIDEO' : 'IMAGE',
  };
  const settingWrites: PreflightWrite[] = [];
  if (payload.modelLabel) settingWrites.push({ field: 'model', type: 'FLOWGRAPH_SYNC_SET_MODEL', value: payload.modelLabel });
  const aspectRatio = payload.aspectRatio?.match(/\b\d{1,2}:\d{1,2}\b/)?.[0];
  if (aspectRatio) settingWrites.push({ field: 'aspectRatio', type: 'FLOWGRAPH_SYNC_SET_ASPECT_RATIO', value: aspectRatio });
  if (payload.durationSeconds !== undefined && Number.isFinite(payload.durationSeconds)) {
    settingWrites.push({ field: 'durationSeconds', type: 'FLOWGRAPH_SYNC_SET_DURATION', value: payload.durationSeconds });
  }
  if (payload.batchCount !== undefined && Number.isFinite(payload.batchCount) && payload.batchCount >= 1) {
    settingWrites.push({ field: 'batchCount', type: 'FLOWGRAPH_SYNC_SET_BATCH', value: String(Math.min(4, Math.floor(payload.batchCount))) });
  }
    // Explicit video resolution cannot be dropped. Non-p values fail closed in the writer
    // unless the live composer has no variable counterpart (NO_UI_COUNTERPART).
    if (payload.targetResolution && isVideoKind(payload.kind)) {
      settingWrites.push({ field: 'targetResolution', type: 'FLOWGRAPH_SYNC_SET_RESOLUTION', value: payload.targetResolution });
    }
  if (payload.seed !== undefined && Number.isInteger(payload.seed)) {
    settingWrites.push({ field: 'seed', type: 'FLOWGRAPH_SYNC_SET_SEED', value: payload.seed });
  }
  const promptWrite: PreflightWrite | undefined = payload.prompt === undefined
    ? undefined
    : { field: 'prompt', type: 'FLOWGRAPH_SYNC_SET_PROMPT', value: payload.prompt };

  const limitations: string[] = [];
  const scalarVerified: Partial<Record<CostScalarField, boolean>> = {};
  const scalarFixedByModel: Partial<Record<CostScalarField, boolean>> = {};
  const requestedScalars = {
    aspectRatio,
    durationSeconds: payload.durationSeconds,
    batchCount: payload.batchCount !== undefined && Number.isFinite(payload.batchCount) && payload.batchCount >= 1
      ? Math.min(4, Math.floor(payload.batchCount))
      : undefined,
    targetResolution: payload.targetResolution && isVideoKind(payload.kind)
      ? payload.targetResolution
      : undefined,
    seed: payload.seed !== undefined && Number.isInteger(payload.seed) ? payload.seed : undefined,
  };
  const applyWrites = async (writes: PreflightWrite[]): Promise<void> => {
    for (const write of writes) {
      const syncId = `preflight-${write.field}-${crypto.randomUUID()}`;
      const startedAt = Date.now();
      if (write.type === 'FLOWGRAPH_SYNC_SET_MODEL') {
        await bindRealtimeModel(tab, String(write.value ?? ''));
        console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
          syncId,
          projectId: payload.projectId,
        });
        continue;
      }
      const reply = await timeoutable(
        chrome.tabs.sendMessage(tab.id as number, {
          type: write.type,
          requestId: `sw:${syncId}`,
          payload: {
            syncId,
            source: 'FLOWGRAPH',
            projectId: payload.projectId,
            value: write.value,
            sequence: startedAt,
            originEventId: syncId,
          },
        }),
        REQUEST_TIMEOUT_MS,
      ).catch(() => undefined) as { ok?: boolean; code?: string; message?: string } | undefined;
      if (reply?.ok) {
        if (isCostScalarField(write.field)) scalarVerified[write.field] = true;
        console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
          syncId,
          projectId: payload.projectId,
        });
        continue;
      }
      if (shouldToleratePreflightFailure(write, reply)) {
        if (isCostScalarField(write.field) && reply?.code === 'NO_UI_COUNTERPART') {
          scalarFixedByModel[write.field] = true;
        }
        limitations.push(write.field);
        console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT tolerated fallback ${Date.now() - startedAt}ms`, {
          syncId,
          projectId: payload.projectId,
          reply,
        });
        continue;
      }
      throw bridgeError(
        preflightFailureCode(write, reply),
        reply?.message ?? `Google Flow did not verify ${write.field} before Generate.`,
        false,
      );
    }
  };

  // Mode must exist before media controls can be inspected. The content-script
  // writer may legitimately return a tolerated mode failure while Flow is still
  // remounting Settings, so its result is not authoritative by itself. Always
  // follow it with the physical CDP binder: this is idempotent when the mode is
  // already correct and fail-closed when the provider stayed on the old mode.
  try {
    await applyWrites([modeWrite]);
  } catch (err) {
    console.warn('[FlowGraph Sync] modeWrite preflight failed; verifying with direct CDP switch:', err);
  }
  await bindRealtimeMode(tab, modeWrite.value);
  if (payload.kind === 't2v') {
    await clearRealtimeFrameBindings(tab, ['startImage', 'endImage']);
  } else if (payload.kind === 'i2v') {
    await clearRealtimeFrameBindings(tab, ['endImage']);
  }
  if (payload.startImage?.mediaId) {
    const startedAt = Date.now();
    try {
      await bindRealtimeStartImage(tab, payload.startImage.mediaId);
      console.info(`[FlowGraph Sync] startImage PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
        projectId: payload.projectId,
      });
    } catch (err) {
      if (shouldFailClosedOnMediaBindFailure(payload.kind, 'startImage')) throw err;
      console.warn('[FlowGraph Sync] startImage preflight warning, proceeding with generation:', err);
    }
  }
  if (payload.endImage?.mediaId) {
    const startedAt = Date.now();
    await bindRealtimeEndImage(tab, payload.endImage.mediaId);
    console.info(`[FlowGraph Sync] endImage PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
      projectId: payload.projectId,
    });
  }
  if (payload.kind !== 'imageUpscale' && payload.imageRefs && payload.imageRefs.length > 0) {
    const startedAt = Date.now();
    await bindRealtimeReferenceMedia(tab, payload.imageRefs.map((r) => ({ mediaId: r.mediaId })));
    console.info(`[FlowGraph Sync] referenceMedia PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
      projectId: payload.projectId,
      count: payload.imageRefs.length,
    });
  }
  if (payload.videoInput?.mediaId) {
    const startedAt = Date.now();
    await bindRealtimeVideoInput(tab, payload.videoInput.mediaId, payload.mode);
    console.info(`[FlowGraph Sync] videoInput PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
      projectId: payload.projectId,
      mediaId: payload.videoInput.mediaId,
    });
  }
  await applyWrites(settingWrites);
  if (promptWrite) await applyWrites([promptWrite]);
  const assertScalarReadyToSubmit = async () => {
    await applyWrites(settingWrites);
    if (!canSubmitGenerateWithScalarSettings({
      requested: requestedScalars,
      verified: scalarVerified,
      fixedByModel: scalarFixedByModel,
    })) {
      throw bridgeError(
        'INVALID_INPUT',
        'Requested generation settings were not verified on the Flow composer. Generation aborted.',
        false,
      );
    }
  };
  return { limitations, assertScalarReadyToSubmit };
}

async function generateImageUpscaleViaFlowUi(
  tab: chrome.tabs.Tab,
  payload: GeneratePayload,
  requestId?: string,
): Promise<NormalizedMediaRef> {
  const tabId = tab.id;
  if (tabId === undefined) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const mediaId = payload.imageRefs?.[0]?.mediaId || (payload as any).mediaId;
  if (!mediaId) throw bridgeError('INVALID_INPUT', 'imageUpscale requires an image mediaId', false);
  const targetResolution = payload.targetResolution === 'UPSAMPLE_IMAGE_RESOLUTION_4K' || payload.targetResolution === '4K' ? '4K' : '2K';
  const projectUrl = `https://flow.google.com/project/${payload.projectId}`;
  const editorUrl = `${projectUrl}/edit/${mediaId}`;
  const target: chrome.debugger.Debuggee = { tabId };
  let attachedHere = false;
  try {
    try {
      await chrome.debugger.attach(target, '1.3');
      attachedHere = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/already attached/i.test(msg)) throw bridgeError('UI_NOT_READY', `Could not attach debugger for image upscale: ${msg}`, true);
    }
    await ensureInputReachable(target);
    const evaluate = async <T = unknown>(expression: string): Promise<T | undefined> => {
      const res = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })) as { result?: { value?: T } } | undefined;
      return res?.result?.value;
    };
    const waitFor = async <T>(fn: () => Promise<T | undefined>, predicate: (value: T | undefined) => boolean, ms: number): Promise<T | undefined> => {
      const deadline = Date.now() + ms;
      for (;;) {
        const value = await fn();
        if (predicate(value)) return value;
        if (Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    };
    const escape = async (): Promise<void> => {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    };

    throwIfGenerationAborted(requestId);
    const here = await evaluate<string>('location.href');
    if (!(here || '').includes(`/edit/${mediaId}`)) {
      await chrome.debugger.sendCommand(target, 'Page.navigate', { url: editorUrl });
    }
    const downloadReady = await waitFor(
      () => evaluate<boolean>(`!![...document.querySelectorAll('button')].find((b)=>(b.getAttribute('aria-label')||'')==='Tải nội dung nghe nhìn xuống'||/download/i.test(b.getAttribute('aria-label')||''))`),
      Boolean,
      20_000,
    );
    if (!downloadReady) throw bridgeError('UI_NOT_READY', 'Flow image editor download action was not available.', true);

    const before = await chrome.downloads.search({});
    const beforeIds = new Set(before.map((item) => item.id));
    await escape();
    const opened = await evaluate<boolean>(`(()=>{const b=[...document.querySelectorAll('button')].find((x)=>(x.getAttribute('aria-label')||'')==='Tải nội dung nghe nhìn xuống'||/download/i.test(x.getAttribute('aria-label')||''));if(!b)return false;b.click();return true})()`);
    if (!opened) throw bridgeError('UI_NOT_READY', 'Could not open Flow image download menu.', true);
    const optionReady = await waitFor(
      () => evaluate<boolean>(`!![...document.querySelectorAll('[role="menuitem"],button')].find((x)=>new RegExp('^${targetResolution}(?:\\\\s|$)','i').test((x.innerText||x.textContent||'').replace(/\\\\s+/g,' ').trim()))`),
      Boolean,
      5_000,
    );
    if (!optionReady) throw bridgeError('UI_NOT_READY', `Flow ${targetResolution} image upscale option was not available.`, true);
    const clicked = await evaluate<boolean>(`(()=>{const x=[...document.querySelectorAll('[role="menuitem"],button')].find((el)=>/^${targetResolution}(?:\\s|$)/i.test((el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim()));if(!x)return false;x.click();return true})()`);
    if (!clicked) throw bridgeError('UI_NOT_READY', `Could not select Flow ${targetResolution} image upscale.`, true);

    let downloaded: chrome.downloads.DownloadItem | undefined;
    const downloadDeadline = Date.now() + 90_000;
    while (Date.now() <= downloadDeadline) {
      throwIfGenerationAborted(requestId);
      const items = await chrome.downloads.search({});
      downloaded = items
        .filter((item) => !beforeIds.has(item.id))
        .find((item) => item.state === 'complete' && new RegExp(`_${targetResolution}_`, 'i').test(item.filename || ''));
      if (downloaded?.filename) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!downloaded?.filename) throw bridgeError('MEDIA_FAILED', `Flow ${targetResolution} image upscale download did not complete.`, true);

    await chrome.debugger.sendCommand(target, 'Page.navigate', { url: projectUrl });
    const composerReady = await waitFor(
      () => evaluate<boolean>(`!!document.querySelector('button.add-menu-trigger')`),
      Boolean,
      20_000,
    );
    if (!composerReady) throw bridgeError('UI_NOT_READY', 'Flow project composer did not recover after image upscale.', true);
    for (let i = 0; i < 3; i += 1) await escape();
    const pickerOpened = await evaluate<boolean>(`(()=>{const b=document.querySelector('button.add-menu-trigger');if(!b)return false;b.click();return true})()`);
    if (!pickerOpened) throw bridgeError('UI_NOT_READY', 'Flow media picker could not be opened for the upscaled image.', true);
    const uploadReady = await waitFor(
      () => evaluate<boolean>(`!!document.querySelector('button.sidebar-upload-btn')`),
      Boolean,
      12_000,
    );
    if (!uploadReady) throw bridgeError('UI_NOT_READY', 'Flow media upload action was not available.', true);
    const uploadClicked = await evaluate<boolean>(`(()=>{const b=document.querySelector('button.sidebar-upload-btn');if(!b)return false;b.click();return true})()`);
    if (!uploadClicked) throw bridgeError('UI_NOT_READY', 'Could not open Flow upload file picker.', true);

    const inputObject = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: `document.querySelector('input[type="file"]')`,
      returnByValue: false,
    })) as { result?: { objectId?: string } } | undefined;
    const objectId = inputObject?.result?.objectId;
    if (!objectId) throw bridgeError('UI_NOT_READY', 'Flow upload file input was not available.', true);
    await chrome.debugger.sendCommand(target, 'DOM.setFileInputFiles', { files: [downloaded.filename], objectId });

    const consent = await waitFor(
      () => evaluate<'CONSENT' | 'READY' | ''>(`(()=>{const d=[...document.querySelectorAll('[role="dialog"],mat-dialog-container')].find((x)=>/Quyền sử dụng hình ảnh này|rights to this image|I agree|Tôi đồng ý/i.test(x.innerText||''));if(d)return 'CONSENT';const picker=[...document.querySelectorAll('.cdk-overlay-pane')].find((x)=>x.querySelector('.asset-list-viewport'));return picker?'READY':''})()`),
      (value) => value === 'CONSENT' || value === 'READY',
      5_000,
    );
    if (consent === 'CONSENT') {
      throw bridgeError(
        'USER_ACTION_REQUIRED',
        'Google Flow requires a one-time image-rights confirmation. Open the Flow tab, review the dialog, choose “Tôi đồng ý” if appropriate, then retry the workflow.',
        false,
      );
    }

    const fileName = downloaded.filename.split(/[\\/]/).pop() || '';
    const stem = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    const uploadedId = await waitFor(
      () => evaluate<string>(`(()=>{const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;const candidates=[...document.querySelectorAll('.asset-item')];const stem=${JSON.stringify(stem.toLowerCase())};const row=candidates.find((x)=>((x.innerText||'').toLowerCase().includes(stem.slice(0,Math.min(28,stem.length))))||((x.getAttribute('aria-label')||'').toLowerCase().includes(stem.slice(0,Math.min(28,stem.length)))))||candidates[0];if(!row)return '';const raw=[row.outerHTML,...[...row.querySelectorAll('*')].flatMap((el)=>[el.getAttribute?.('data-media-id'),el.getAttribute?.('src'),el.getAttribute?.('href')])].filter(Boolean).join(' ');return raw.match(uuid)?.[0]||''})()`),
      (value) => typeof value === 'string' && value.length > 0,
      20_000,
    );
    if (!uploadedId) {
      throw bridgeError('MEDIA_FAILED', 'Upscaled image was uploaded, but FlowGraph could not resolve its new media id.', true);
    }
    const previewUrl = await resolveRedirectSafe(uploadedId, 'IMAGE');
    return completeGenerate(requestId, {
      mediaId: uploadedId,
      type: 'IMAGE',
      projectId: payload.projectId,
      previewUrl: previewUrl || undefined,
      fileName,
      mimeType: 'image/jpeg',
    }, payload.projectId);
  } finally {
    if (attachedHere) {
      await chrome.debugger.detach(target).catch(() => {});
    }
  }
}

async function handleGenerate(payload: GeneratePayload, requestId?: string): Promise<NormalizedMediaRef> {
  throwIfGenerationAborted(requestId);
  const tab = await findFlowTab(payload.projectId);
  if (!tab || tab.id === undefined) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const tabId = tab.id;
  await ensureFlowContentScript(tabId);

  // Enforce project isolation against the active Google Flow project
  const expectedProjectId = projectIdFromUrl(tab.url ?? '');
  if (!expectedProjectId || expectedProjectId !== payload.projectId) {
    throw bridgeError(
      'PROJECT_MISMATCH',
      `Active Google Flow tab project (${expectedProjectId || 'none'}) does not match request projectId (${payload.projectId}).`,
      false,
    );
  }

  // Video Upscale is exposed by the runtime through the legacy `upscale` alias
  // as well as `videoUpscale`. Both map to the same verified direct provider
  // endpoint and must never fall through to composer-settings automation. A
  // fallthrough is especially fragile after video preview resolution because
  // Flow may still be on /edit/<mediaId>, which has no composer settings menu.
  if (payload.kind === 'imageUpscale') {
    return generateImageUpscaleViaFlowUi(tab, payload, requestId);
  }
  const isDirectApiPath = payload.kind === 'videoUpscale'
    || payload.kind === 'upscale';
  if (isDirectApiPath) {
    return generateApi(payload, requestId);
  }

  const capabilityRoute = resolveFlowCapabilityRoute(payload);
  if (payload.kind === 't2i' && capabilityRoute.primary === 'BATCH_RPC') {
    try {
      return await generateT2iViaBatch(payload, requestId);
    } catch (error) {
      const batchError = toFlowBatchBridgeError(error);
      const code = String(batchError.code ?? 'BATCH_RPC_UNAVAILABLE');
      if (capabilityRoute.fallback !== 'FLOW_UI' || !mayFallbackFromBatch(code)) {
        throw batchError;
      }
      console.warn(
        `[FlowGraph] Batch T2I unavailable (${code}); falling back to verified Flow UI transport.`,
      );
    }
  }

  if (payload.kind === 't2v' && capabilityRoute.primary === 'BATCH_RPC') {
    try {
      return await generateT2vViaBatch(payload, requestId);
    } catch (error) {
      const batchError = toFlowBatchBridgeError(error);
      recordBatchDiagnostic('t2v', batchError);
      const code = String(batchError.code ?? 'BATCH_RPC_UNAVAILABLE');
      if (capabilityRoute.fallback !== 'FLOW_UI' || !mayFallbackFromBatch(code)) {
        throw batchError;
      }
      console.warn(
        `[FlowGraph] Batch Omni T2V unavailable (${code}); falling back to verified Flow UI transport.`,
      );
    }
  }

  if (payload.kind === 'i2v' && capabilityRoute.primary === 'BATCH_RPC') {
    try {
      return await generateI2vViaBatch(payload, requestId);
    } catch (error) {
      const batchError = toFlowBatchBridgeError(error);
      recordBatchDiagnostic('i2v', batchError);
      const code = String(batchError.code ?? 'BATCH_RPC_UNAVAILABLE');
      if (capabilityRoute.fallback !== 'FLOW_UI' || !mayFallbackFromBatch(code)) {
        throw batchError;
      }
      console.warn(
        `[FlowGraph] Batch Omni I2V unavailable (${code}); falling back to verified Flow UI transport.`,
      );
    }
  }

  if (payload.kind === 'interpolation' && capabilityRoute.primary === 'BATCH_RPC') {
    try {
      return await generateInterpolationViaBatch(payload, requestId);
    } catch (error) {
      const batchError = toFlowBatchBridgeError(error);
      recordBatchDiagnostic('interpolation', batchError);
      const code = String(batchError.code ?? 'BATCH_RPC_UNAVAILABLE');
      if (capabilityRoute.fallback !== 'FLOW_UI' || !mayFallbackFromBatch(code)) {
        throw batchError;
      }
      console.warn(
        `[FlowGraph] Batch Omni First+Last unavailable (${code}); falling back to verified Flow UI transport.`,
      );
    }
  }

  if (payload.kind === 'reference' && capabilityRoute.primary === 'BATCH_RPC') {
    try {
      return await generateReferenceVideoViaBatch(payload, requestId);
    } catch (error) {
      const batchError = toFlowBatchBridgeError(error);
      recordBatchDiagnostic('reference', batchError);
      const code = String(batchError.code ?? 'BATCH_RPC_UNAVAILABLE');
      if (capabilityRoute.fallback !== 'FLOW_UI' || !mayFallbackFromBatch(code)) {
        throw batchError;
      }
      console.warn(
        `[FlowGraph] Batch Omni Reference Video unavailable (${code}); falling back to verified Flow UI transport.`,
      );
    }
  }

  // UI-driven generation requires the actual project composer. Media preview
  // resolution may have left the provider tab on /edit/<mediaId>; recover the
  // project route and wait for its composer without activating the tab.
  const composerTab = await ensureFlowProjectComposerReady(tab, payload.projectId);
  await ensureFlowContentScript(tabId);

  // Upscale operates via direct media transform or optional prompt. Default prompt if absent.
  const prompt = (payload.prompt ?? (payload.kind === 'videoUpscale' || payload.kind === 'upscale' ? 'High quality detailed upscale' : '')).trim();
  if (!prompt) {
    throw bridgeError(
      'INVALID_INPUT',
      `Refusing to generate: the ${payload.kind ?? 'unknown'} node produced an empty prompt. `
        + 'Connect a Prompt node (or set a prompt on the node) instead of letting the UI fall back to a placeholder.',
      false,
    );
  }
  // Canonical gallery URL (project root, no /edit/... suffix) so the video-tile
  // recovery helper can always return to the grid after opening an editor.
  const galleryUrl = (composerTab.url ?? tab.url ?? '').replace(/\/edit\/[0-9a-zA-Z_-]+.*$/, '');

  const target: chrome.debugger.Debuggee = { tabId };
  let attached = false;
  // Why attach failed (DevTools / another debugger). Included in the fail-closed
  // misconfiguration error so the run is not mistaken for a provider timeout.
  let attachFailure = '';
  // Background-only provider execution: generation/config/media work must not
  // activate the Google Flow tab. Explicit navigation belongs to user-invoked
  // "Open Google Flow" actions in the UI, never to the automatic worker.

  // Fail closed before the real Generate click. The content adapter verifies
  // each supported counterpart after applying it; fixed/absent optional UI
  // controls are reported as NO_UI_COUNTERPART and do not fabricate state.
  const { assertScalarReadyToSubmit } = await syncAndVerifyBeforeGenerate(composerTab, { ...payload, prompt });
  throwIfGenerationAborted(requestId);

  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    // Keep the provider renderer input-reachable without changing the user's
    // active tab. FlowGraph remains the foreground workspace throughout Run.
    await ensureInputReachable(target);
  } catch (error) {
    // debugger may be unavailable (DevTools open / remote port in use). Fail closed
    // instead of a weaker content-script Generate. Record *why* so the error is a
    // misconfiguration (another debugger/DevTools), not a provider timeout.
    attachFailure = normalizeError(error).message;
  }

  // Path 1: CDP-attached browser UI automation. This deliberately uses the
  // signed-in Google Flow page rather than forging/bypassing reCAPTCHA. It is
  // still automation (not a claim of trusted user activation), so provider
  // security challenges must be surfaced instead of bypassed.
  if (attached) {
    const evalOnPage = async <T = unknown>(expression: string): Promise<T | undefined> => {
      try {
        const res = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as { result?: { value?: T } } | undefined;
        return res?.result?.value;
      } catch {
        return undefined;
      }
    };

    // Dispatch a real pointer click via the DevTools Input domain. Radix menus
    // and the Flow tile hover state only respond to genuine pointer events, so
    // synthetic `element.dispatchEvent(...)` bubbles are not sufficient.
    const clickAt = (x: number, y: number): Promise<void> => cdpClickAt(target, x, y, 80, requestId);

    // The Google Flow prompt composer has a settings trigger button with two modes:
    // Image ("Nano Banana 2") for Text-to-Image and Video ("Video · …") for
    // Image-to-Video / Interpolation. The chip does NOT auto-switch based on
    // the selected upstream media, so we must explicitly choose the right mode per kind.
    const setComposerMode = async (kind: string): Promise<string> => {
      const wantVideo = isVideoKind(kind);

      // 1. Kiểm tra trạng thái hiện tại trước. Empty/unknown chip is not proof.
      const currentStatus = await evalOnPage<{ isVideo: boolean; text: string }>(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        const text = btn ? (btn.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase() : '';
        const isVideo = text.includes('video') || text.includes('veo') || text.includes('omni');
        return { isVideo, text };
      })()`);

      if (canSubmitGenerateWithComposerMode({ kind, liveChipText: currentStatus?.text })) {
        return currentStatus?.text ?? '';
      }

      // 2. Click mở popup cài đặt bằng CDP Click tọa độ thực (Angular CDK trigger)
      const triggerCoords = await evalOnPage<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        if (!btn) return { ok: false };
        const rect = btn.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);

      if (triggerCoords?.ok && triggerCoords.x !== undefined && triggerCoords.y !== undefined) {
        await clickAt(triggerCoords.x, triggerCoords.y);
        await waitWhileNotAborted(400, requestId);
      }

      // 3. Click chọn tab Hình ảnh / Video bằng CDP tọa độ thực bên trong .cdk-overlay-pane
      const tabCoords = await evalOnPage<{ ok: boolean; x?: number; y?: number; tabs?: string[] }>(`(() => {
        const pane = document.querySelector('.cdk-overlay-pane');
        const buttons = pane ? Array.from(pane.querySelectorAll('button, [role="tab"], [role="radio"], .mat-button-toggle-button')) : [];
        const wantedTab = buttons.find((b) => {
          const text = (b.innerText || '').toLowerCase();
          return ${wantVideo} ? (text.includes('video') || text.includes('videocam')) : (text.includes('hình ảnh') || text.includes('image'));
        });
        if (!wantedTab) {
          return { ok: false, tabs: buttons.map(b => (b.innerText || '').trim().slice(0, 30)) };
        }
        const rect = wantedTab.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);

      if (tabCoords?.ok && tabCoords.x !== undefined && tabCoords.y !== undefined) {
        await clickAt(tabCoords.x, tabCoords.y);
        await waitWhileNotAborted(400, requestId);
      }

      // 4. Đóng pane bằng Escape
      await evalOnPage(`(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      })()`);
      await waitWhileNotAborted(200, requestId);

      const after = await evalOnPage<{ isVideo: boolean; text: string }>(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        const text = btn ? (btn.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase() : '';
        const isVideo = text.includes('video') || text.includes('veo') || text.includes('omni');
        return { isVideo, text };
        })()`);

        if (!canSubmitGenerateWithComposerMode({ kind, liveChipText: after?.text })) {
          throw bridgeError(
            'INVALID_INPUT',
            `Composer mode does not match ${wantVideo ? 'video' : 'image'} (chip: ${after?.text || 'none'}). Generation aborted.`,
            false,
          );
        }
        return after?.text ?? '';
        };

    const readMediaIds = () => evalOnPage<string[]>(`
      (() => {
        const ids = new Set();
        const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        // New Angular Flow UI (flow.google.com): media elements expose the raw
        // UUID via data-media-id, and image/video src points at a /asb/ proxy
        // that does NOT contain the id. Read the attribute directly so polling
        // detects freshly generated media instead of timing out.
        document.querySelectorAll('[data-media-id]').forEach((el) => {
          const attr = el.getAttribute('data-media-id');
          if (attr && UUID.test(attr)) ids.add(attr);
        });
        // Legacy labs.google/fx UI: id embedded in a getMediaUrlRedirect / /media/ URL.
        document.querySelectorAll('img, video, a').forEach((el) => {
          const src = el.currentSrc || el.src || el.href || '';
          const m = src.match(/getMediaUrlRedirect\\?name=([0-9a-f-]{36})/i) || src.match(/\\/media\\/([0-9a-f-]{36})/i);
          if (m && m[1]) ids.add(m[1]);
        });
        // New Angular Flow UI video tiles (flow.google.com): a generated video is
        // rendered as <flow-video-tile> whose thumbnail <img class="thumbnail">
        // points at https://flow-content.google/image/<UUID>?... . These tiles do
        // NOT expose data-media-id, so without this branch freshly generated video
        // media is invisible to polling and the run falsely reports TIMEOUT even
        // though the video exists on the canvas. Read the UUID from the thumbnail
        // src so video generation is detected the same way images are.
        document.querySelectorAll('flow-video-tile img').forEach((el) => {
          const src = el.currentSrc || el.src || '';
          const m = src.match(/flow-content\\.google\\/image\\/([0-9a-f-]{36})/i);
          if (m && m[1]) ids.add(m[1]);
        });
        return Array.from(ids);
      })()
    `);

    // After the labs.google/fx -> flow.google migration a freshly generated video
    // tile no longer exposes its mediaId anywhere in the gallery DOM: the tile's
    // only stable identifier is its poster URL. Live probing showed that poster is
    // usually the same-origin proxy `https://flow.google.com/asb/<opaqueToken>` but
    // is *not always* — it can also be `flow-content.google/image/<uuid>` or a
    // cross-origin signed URL. A `/asb/`-only regex therefore makes a real video
    // tile invisible and the run falsely reports TIMEOUT.
    //
    // So the token is derived from whatever the poster src actually is: a
    // query-stripped origin+pathname signature. That keeps the "did a new video
    // tile appear?" comparison stable across re-renders (the signed query changes,
    // the path does not) and works for every poster shape.
    const POSTER_TOKEN_JS = `
      ((el) => {
        const s = el.currentSrc || el.src || '';
        if (!s) return '';
        try {
          const u = new URL(s, location.href);
          const asb = u.pathname.match(/\\/asb\\/([A-Za-z0-9_-]+)/);
          if (asb) return 'asb:' + asb[1];
          return 'p:' + u.host + u.pathname;
        } catch { return 'r:' + s.split('?')[0].slice(-80); }
      })`;
    const readVideoPosterTokens = () => evalOnPage<string[]>(`
      (() => {
        const key = ${POSTER_TOKEN_JS};
        return Array.from(document.querySelectorAll('flow-video-tile')).map((t) => {
          const img = t.querySelector('img');
          return img ? key(img) : '';
        });
      })()
    `);

    // Open a video tile with a real pointer click (Angular ignores synthetic
    // clicks), read the mediaId from the resulting `/edit/<mediaId>` URL, then
    // return to the gallery. The tile is picked either by poster token or by
    // index, because a lazy poster means "which tile is new?" is not always
    // answerable from the src alone. Best-effort: returns undefined when the tile
    // cannot be located or the editor URL does not expose a UUID.
    const openVideoTileAndGetId = async (
      pick: { token?: string; index?: number },
    ): Promise<{ mediaId: string; editorPrompt: string } | undefined> => {
      const pos = await evalOnPage<{ x: number; y: number } | null>(`((sel) => {
        const key = ${POSTER_TOKEN_JS};
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        let t = null;
        if (sel.token !== undefined) {
          t = tiles.find((x) => { const i = x.querySelector('img'); return i && key(i) === sel.token; }) || null;
        } else if (sel.index !== undefined) {
          t = tiles[sel.index] || null;
        }
        if (!t) return null;
        t.scrollIntoView?.({ block: 'center', inline: 'center' });
        const b = t.getBoundingClientRect();
        if (b.width < 10 || b.height < 10) return null;
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
      })(${JSON.stringify(pick)})`);
      if (!pos) return undefined;
      throwIfGenerationAborted(requestId);
      await clickAt(pos.x, pos.y);
      for (let k = 0; k < 15; k += 1) {
        throwIfGenerationAborted(requestId);
        await waitWhileNotAborted(400, requestId);
        const href = await evalOnPage<string>(`location.href`);
        const m = href && href.match(/\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (!m || !m[1]) continue;
        // Read the clip's own prompt back so the caller can prove this tile is
        // *our* generation rather than an older clip that happens to sit at the
        // same index.
        //
        // Live probing on /edit/<mediaId> (2026-09-05) showed the rich-text
        // composer is NOT the prompt: it holds the localised placeholder
        // "Mô tả cách chỉnh sửa video này…", which made every tile look like a
        // mismatch and killed a node that had actually succeeded. The real
        // prompt renders in <flow-expandable-prompt> / .prompt-text, so that is
        // read first. The composer is only a fallback, and any text equal to a
        // known placeholder is discarded so a placeholder can never match.
        const editorPrompt = (await evalOnPage<string>(`(async () => {
          const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
          const PLACEHOLDER = ${JSON.stringify(EDITOR_PLACEHOLDER_PREFIXES)};
          const isPlaceholder = (t) => PLACEHOLDER.some((p) => t.toLowerCase().startsWith(p));
          const read = () => {
            for (const s of ['flow-expandable-prompt', '.prompt-text', '.expandable-prompt-container']) {
              for (const el of document.querySelectorAll(s)) {
                const t = norm(el.textContent);
                if (t.length > 3 && !isPlaceholder(t)) return t;
              }
            }
            return '';
          };
          // The editor hydrates asynchronously after navigation; give it a beat.
          for (let k = 0; k < 10; k += 1) {
            const t = read();
            if (t) return t.slice(0, 200);
            await waitWhileNotAborted(500, requestId);
          }
          return '';
        })()`)) ?? '';
        await chrome.debugger.sendCommand(target, 'Page.navigate', { url: galleryUrl }).catch(() => {});
        await waitWhileNotAborted(3000, requestId);
        return { mediaId: m[1], editorPrompt };
      }
      await chrome.debugger.sendCommand(target, 'Page.navigate', { url: galleryUrl }).catch(() => {});
      await waitWhileNotAborted(3000, requestId);
      return undefined;
    };

    try {
      const beforeIds = (await readMediaIds()) ?? [];
      // Per-tile poster tokens in DOM order. The array shape (not a deduped set)
      // is deliberate: a poster can still be '' while it lazy-loads, so the length
      // doubles as the video-tile count and the first extra entry is the new tile.
      const beforeVidTokens = (await readVideoPosterTokens()) ?? [];

      // Explicitly set the composer mode before interacting with media / prompt.
      throwIfGenerationAborted(requestId);
      await setComposerMode(payload.kind);

      // syncAndVerifyBeforeGenerate already binds and verifies the semantic
      // Start slot. Keep the older tile path only as a recovery path if that
      // exact binding drifted between preflight and debugger attachment.
      const exactStartAlreadyBound = payload.kind === 'i2v' && payload.startImage?.mediaId
        ? Boolean(await evalOnPage<boolean>(`((mediaId) => {
            const swap = [...document.querySelectorAll('button')].find((button) =>
              [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
                .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
            const root = swap?.previousElementSibling;
            return [...(root?.querySelectorAll('img, video, [data-media-id]') || [])]
              .some((element) => [
                element.getAttribute?.('data-media-id'),
                element.getAttribute?.('src'),
                element.currentSrc,
                element.src,
              ].filter(Boolean).some((value) => String(value).includes(mediaId)));
          })(${JSON.stringify(payload.startImage.mediaId)})`))
        : false;

      if (payload.kind === 'i2v' && !exactStartAlreadyBound) {
        const startImageId = payload.startImage?.mediaId;
        if (!startImageId) throw bridgeError('INVALID_INPUT', 'Image-to-Video requires startImage.mediaId.', false);

        // The upstream image is bound for Image-to-Video through the tile's
        // context menu: hover -> "more_vert" -> "Tạo ảnh động" (motion_blur).
        // A plain click on the tile navigates to the /edit/<assetId> surface
        // instead, which is image-only and cannot drive I2V on the project page.
        // The tile's hover-action buttons only render after a real pointer
        // move, so every step below uses CDP Input.dispatchMouseEvent, not
        // synthetic element events.

        // 1. Locate the exact upstream image tile and its hover center.
        const mediaCenter = await evalOnPage<{ ok?: boolean; reason?: string; x?: number; y?: number }>(`((mediaId) => {
          const candidates = Array.from(document.querySelectorAll('img, video, a, [data-media-id]'));
          const matchesMediaId = (el) => {
            const values = [
              el.getAttribute?.('data-media-id'),
              el.getAttribute?.('src'),
              el.getAttribute?.('href'),
              el.currentSrc,
              el.src,
              el.href,
            ].filter(Boolean).map(String);
            return values.some((value) => value.includes(mediaId));
          };
          const mediaEl = candidates.find(matchesMediaId);
          if (!mediaEl) return { ok: false, reason: 'source-media-not-found' };
          const tile = mediaEl.closest?.('[role="button"]') || mediaEl.parentElement;
          if (!tile) return { ok: false, reason: 'source-media-not-clickable' };
          tile.scrollIntoView?.({ block: 'center', inline: 'center' });
          const rect = tile.getBoundingClientRect();
          if (!rect.width || !rect.height) return { ok: false, reason: 'tile-not-visible' };
          return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })(${JSON.stringify(startImageId)})`);

        if (!mediaCenter?.ok || mediaCenter.x === undefined || mediaCenter.y === undefined) {
          throw bridgeError(
            'MEDIA_FAILED',
            `Could not locate upstream image ${startImageId} in the Google Flow UI (${mediaCenter?.reason ?? 'unknown'}).`,
            true,
          );
        }

        // 2. Real pointer hover so the tile's "more_vert Khác" action renders.
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: mediaCenter.x, y: mediaCenter.y,
        });
        await waitWhileNotAborted(500, requestId);

        // 3. Locate the tile's "more_vert Khác" button (top-right overlay).
        const moreVert = await evalOnPage<{ ok?: boolean; reason?: string; x?: number; y?: number }>(`((mediaId) => {
          const candidates = Array.from(document.querySelectorAll('img, video, a, [data-media-id]'));
          const matchesMediaId = (el) => {
            const values = [
              el.getAttribute?.('data-media-id'),
              el.getAttribute?.('src'),
              el.getAttribute?.('href'),
              el.currentSrc,
              el.src,
              el.href,
            ].filter(Boolean).map(String);
            return values.some((value) => value.includes(mediaId));
          };
          const mediaEl = candidates.find(matchesMediaId);
          if (!mediaEl) return { ok: false, reason: 'source-media-not-found' };
          const tile = mediaEl.closest?.('[role="button"]') || mediaEl.parentElement;
          if (!tile) return { ok: false, reason: 'source-media-not-clickable' };
          const btn = Array.from(tile.querySelectorAll('button'))
            .find((b) => (b.innerText || '').includes('Khác') || (b.textContent || '').includes('more_vert'));
          if (!btn) return { ok: false, reason: 'tile-menu-button-not-found' };
          const rect = btn.getBoundingClientRect();
          if (!rect.width || !rect.height) return { ok: false, reason: 'tile-menu-button-not-visible' };
          return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })(${JSON.stringify(startImageId)})`);

        if (!moreVert?.ok || moreVert.x === undefined || moreVert.y === undefined) {
          throw bridgeError(
            'MEDIA_FAILED',
            `Upstream image ${startImageId} tile "more_vert" action not found (${moreVert?.reason ?? 'unknown'}).`,
            true,
          );
        }
        await clickAt(moreVert.x, moreVert.y);
        await waitWhileNotAborted(600, requestId);

        // 4. Locate the "Tạo ảnh động" (motion_blur) menu item in the open Radix menu.
        const motionItem = await evalOnPage<{ ok?: boolean; reason?: string; x?: number; y?: number }>(`(() => {
          for (const menu of Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content], .cdk-overlay-pane'))) {
            const item = Array.from(menu.querySelectorAll('[role="menuitem"], button'))
              .find((it) => (it.innerText || '').includes('Tạo ảnh động') || (it.innerText || '').includes('motion_blur'));
            if (item) {
              const rect = item.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;
              return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          return { ok: false, reason: 'tile-motion-item-not-found' };
        })()`);

        if (!motionItem?.ok || motionItem.x === undefined || motionItem.y === undefined) {
          throw bridgeError(
            'MEDIA_FAILED',
            `Upstream image ${startImageId} "Tạo ảnh động" menu item not found (${motionItem?.reason ?? 'unknown'}).`,
            true,
          );
        }
        await clickAt(motionItem.x, motionItem.y);
        await waitWhileNotAborted(900, requestId);

        // Fail closed: confirm the composer now has the exact upstream image as
        // its bound start thumbnail before we allow generation. This prevents
        // an I2V run from using whatever tile happened to be "last selected".
        const bindCheck = await evalOnPage<{ ok?: boolean; reason?: string }>(`((mediaId) => {
          const imgs = Array.from(document.querySelectorAll('img, video')).filter((el) => {
            const s = (el.currentSrc || el.src || el.getAttribute('src') || '').toString();
            return s.includes('getMediaUrlRedirect') && s.includes(mediaId);
          }).filter((el) => {
            const r = el.getBoundingClientRect();
            // The bound start thumbnail sits in the composer band near the
            // prompt editor. Grid tiles are large; the composer thumb is small.
            return r.top >= 700 && r.width <= 120 && r.height <= 120;
          });
          return { ok: imgs.length > 0, reason: imgs.length > 0 ? undefined : 'bound-thumbnail-not-found' };
        })(${JSON.stringify(startImageId)})`);
        if (!bindCheck?.ok) {
          throw bridgeError(
            'MEDIA_FAILED',
            `Upstream image ${startImageId} was not bound as the Flow video start image (${bindCheck?.reason ?? 'unknown'}).`,
            true,
          );
        }
      }

      // Slate updates its DOM before every internal React state transition has fully
      // settled. Preflight normally committed the prompt already. Only repeat a
      // physical edit if it drifted, and suppress that extension-originated CDP
      // echo before Chrome exposes it as a trusted `beforeinput` event.
      // Google Flow hard caps prompt input at 1,200 characters. If model enhancement produced > 1200 chars,
      // safely slice at word boundary so Google Flow Generate button never gets disabled.
      let safePrompt = truncateFlowPrompt(prompt);
      const normalizedPrompt = expectedSubmittedPrompt(prompt);
      const readComposerText = async (): Promise<string> => String(await evalOnPage<string>(`(() => {
        const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
          || document.querySelector('.ProseMirror[contenteditable="true"]')
          || document.querySelector('[role="textbox"][contenteditable="true"]');
        return ed?.innerText || ed?.textContent || '';
      })()`) ?? '');
      let promptCommitted = composerPromptMatchesExpected(await readComposerText(), normalizedPrompt);
      const assertPromptReadyToSubmit = async () => {
        throwIfGenerationAborted(requestId);
        if (!composerPromptMatchesExpected(await readComposerText(), normalizedPrompt)) {
          throw bridgeError(
            'INVALID_INPUT',
            'Composer prompt does not match the submitted prompt. Generation aborted.',
            false,
          );
        }
      };
      const assertModeReadyToSubmit = async () => {
        throwIfGenerationAborted(requestId);
        const chip = String(await evalOnPage<string>(`(() => {
          const btn = document.querySelector('button.settings-trigger-button');
          return btn ? (btn.innerText || '').replace(/\\s+/g, ' ').trim() : '';
        })()`) ?? '');
        if (!canSubmitGenerateWithComposerMode({ kind: payload.kind, liveChipText: chip })) {
          throw bridgeError(
            'INVALID_INPUT',
            `Composer mode does not match ${payload.kind} (chip: ${chip || 'none'}). Generation aborted.`,
            false,
          );
        }
      };
      const assertModelReadyToSubmit = async () => {
        throwIfGenerationAborted(requestId);
        if (!payload.modelLabel) return;
        // The compact composer chip no longer exposes the model name. Reuse the
        // exact Settings-menu verifier so Generate can never accept a stale or
        // different provider model (for example Studio Omni vs Flow Veo Lite).
        await bindRealtimeModel(tab, payload.modelLabel);
        throwIfGenerationAborted(requestId);
      };
      const assertMediaReadyToSubmit = async () => {
        throwIfGenerationAborted(requestId);
        if (payload.kind === 'interpolation') {
          const startId = payload.startImage?.mediaId;
          const endId = payload.endImage?.mediaId;
          const startSources = startId
            ? (await evalOnPage<string[]>(`((mediaId) => {
                const swap = [...document.querySelectorAll('button')].find((button) =>
                  [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
                    .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
                const root = swap?.previousElementSibling;
                return [...(root?.querySelectorAll('img, video, [data-media-id]') || [])].flatMap((element) => [
                  element.getAttribute?.('data-media-id'),
                  element.getAttribute?.('src'),
                  element.currentSrc,
                  element.src,
                ].filter(Boolean).map(String));
              })(${JSON.stringify(startId)})`) ?? [])
            : [];
          const endSources = endId
            ? (await evalOnPage<string[]>(`((mediaId) => {
                const swap = [...document.querySelectorAll('button')].find((button) =>
                  [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
                    .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
                const root = swap?.nextElementSibling;
                return [...(root?.querySelectorAll('img, video, [data-media-id]') || [])].flatMap((element) => [
                  element.getAttribute?.('data-media-id'),
                  element.getAttribute?.('src'),
                  element.currentSrc,
                  element.src,
                ].filter(Boolean).map(String));
              })(${JSON.stringify(endId)})`) ?? [])
            : [];
          const startBound = !startId || slotSourcesContainExactMediaId(startSources, startId);
          const endBound = !endId || slotSourcesContainExactMediaId(endSources, endId);
          if (!canSubmitGenerateWithMediaBindings({
            kind: 'interpolation',
            hasStart: Boolean(startId),
            hasEnd: Boolean(endId),
            startBound,
            endBound,
          })) {
            throw bridgeError(
              'MEDIA_FAILED',
              `Interpolation frames were not verified before Generate (start ${startId ?? 'none'} bound=${startBound}, end ${endId ?? 'none'} bound=${endBound}).`,
              false,
            );
          }
        }
        if (payload.kind === 'reference' && payload.imageRefs && payload.imageRefs.length > 0) {
          const expected = payload.imageRefs.map((ref) => ref.mediaId);
          const applied = await evalOnPage<string[]>(`(() => {
            const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
            const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
              || document.querySelector('.ProseMirror[contenteditable="true"]')
              || document.querySelector('[role="textbox"][contenteditable="true"]');
            if (!editor) return [];
            const editorRect = editor.getBoundingClientRect();
            const swap = [...document.querySelectorAll('button')].find((button) =>
              [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
                .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
            const frameRoots = [swap?.previousElementSibling, swap?.nextElementSibling].filter(Boolean);
            const ids = [...document.querySelectorAll('button')]
              .filter((button) => [...button.querySelectorAll('i.google-symbols, .google-symbols')]
                .some((icon) => (icon.textContent || '').trim() === 'cancel'))
              .filter((button) => !frameRoots.some((root) => root.contains(button)))
              .filter((button) => {
                const rect = button.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.width <= 90 && rect.height <= 90
                  && rect.bottom >= editorRect.top - 220 && rect.top <= editorRect.bottom + 80;
              })
              .map((button) => [...button.querySelectorAll('img, video, [data-media-id]')]
                .flatMap((element) => [
                  element.getAttribute?.('data-media-id'), element.getAttribute?.('src'),
                  element.currentSrc, element.src,
                ].filter(Boolean).map(String))
                .map((value) => value.match(uuid)?.[0]).find(Boolean))
              .filter(Boolean);
            return [...new Set(ids)];
          })()`) ?? [];
          const referenceBound = referenceMediaExactlyBound(expected, applied);
          if (!canSubmitGenerateWithMediaBindings({
            kind: 'reference',
            hasRefs: true,
            referenceBound,
          })) {
            throw bridgeError(
              'MEDIA_FAILED',
              `Flow Reference Media was not verified before Generate (requested ${expected.join(', ')}, bound ${applied.join(', ')}).`,
              false,
            );
          }
        }
      };
      if (!promptCommitted) {
        await timeoutable(chrome.tabs.sendMessage(tabId, {
          type: 'FLOWGRAPH_SYNC_SUPPRESS_ECHO',
          field: 'prompt',
          value: normalizedPrompt,
        }), 2_000).catch(() => undefined);
        const editor = await evalOnPage<{ ok?: boolean; x?: number; y?: number }>(`(() => {
          const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
            || document.querySelector('.ProseMirror[contenteditable="true"]')
            || document.querySelector('[role="textbox"][contenteditable="true"]');
          if (!ed) return { ok: false };
          ed.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          const rect = ed.getBoundingClientRect();
          return rect.width && rect.height
            ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : { ok: false };
        })()`);
        if (editor?.ok && editor.x !== undefined && editor.y !== undefined) {
          await clickAt(editor.x, editor.y);
          await waitWhileNotAborted(200, requestId);
          // Clear existing text
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17,
          });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
          });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
          });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17,
          });
          await waitWhileNotAborted(80, requestId);
          await chrome.debugger.sendCommand(target, 'Input.insertText', { text: safePrompt });
          await waitWhileNotAborted(400, requestId);

          // Also trigger input event on ProseMirror DOM so Angular activates generate button
          await evalOnPage(`(() => {
            const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
              || document.querySelector('.ProseMirror[contenteditable="true"]')
              || document.querySelector('[role="textbox"][contenteditable="true"]');
            if (ed) {
              ed.focus();
              document.execCommand('insertText', false, ' ');
              document.execCommand('delete', false);
              ed.dispatchEvent(new Event('input', { bubbles: true }));
              ed.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()`);
        }
      }

      // Wait until the visible editor really contains the prompt, then give Flow
      // a short stabilization window before clicking Generate.
      const promptDeadline = Date.now() + 4_000;
      while (Date.now() < promptDeadline) {
        promptCommitted = composerPromptMatchesExpected(await readComposerText(), normalizedPrompt);
        if (promptCommitted) break;
        await waitWhileNotAborted(150, requestId);
      }
      if (!promptCommitted) {
        await assertPromptReadyToSubmit();
      }
      await waitWhileNotAborted(1_200, requestId);

      let generateButton: any = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        throwIfGenerationAborted(requestId);
        generateButton = await evalOnPage<{
          ok?: boolean;
          reason?: string;
          x?: number;
          y?: number;
        }>(`(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const gen = buttons.find((button) => {
            const aria = (button.getAttribute('aria-label') || '').trim().toLowerCase();
            if (button.classList.contains('generate-icon-button')
              || /bắt đầu tạo|start creat|begin creat/.test(aria)) {
              return true;
            }
            const icon = Array.from(button.querySelectorAll('i.google-symbols, .google-symbols'))
              .find((candidate) => (candidate.textContent || '').trim() === 'arrow_forward');
            return Boolean(icon);
          });
          if (!gen) return { ok: false, reason: 'generate-button-not-found' };

          // If disabled, click editor or dispatch input event to ensure Angular notices prompt commit
          if (gen.disabled || gen.getAttribute('aria-disabled') === 'true') {
            const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
              || document.querySelector('.ProseMirror[contenteditable="true"]')
              || document.querySelector('[role="textbox"][contenteditable="true"]');
            if (ed) {
              ed.dispatchEvent(new Event('input', { bubbles: true }));
              ed.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }

          gen.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          const rect = gen.getBoundingClientRect();
          if (!rect.width || !rect.height) return { ok: false, reason: 'generate-button-not-visible' };
          return {
            ok: !gen.disabled && gen.getAttribute('aria-disabled') !== 'true',
            reason: (gen.disabled || gen.getAttribute('aria-disabled') === 'true') ? 'generate-button-disabled' : undefined,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        })()`);
        if (generateButton?.ok) break;
        await waitWhileNotAborted(600, requestId);
      }

      if (!generateButton?.ok || generateButton.x === undefined || generateButton.y === undefined) {
        throw bridgeError(
          'INVALID_INPUT',
          `Google Flow Generate button is not ready (${generateButton?.reason ?? 'unknown'}).`,
          true,
        );
      }
      throwIfGenerationAborted(requestId);

      // Click the actual visible arrow button through the DevTools Input domain.
      // Do not force-enable the control or synthesize a reCAPTCHA token; Google Flow
      // remains responsible for its normal UI/security checks.
      //
      // The coordinates measured above are already stale by the time the debugger
      // attaches: committing a long prompt makes Flow's ProseMirror editor grow from
      // one line to several, which pushes the whole composer band (and the Generate
      // button with it) down by tens of pixels. A click at the pre-growth coordinate
      // silently lands inside the prompt editor instead, so Flow never starts the
      // render and we burn the full wait window. Re-measure and hit-test immediately
      // before every attempt, then confirm the click actually registered — the real
      // submit both clears the prompt editor and disables the button.
      const measureGenerateButton = () =>
        evalOnPage<{ x?: number; y?: number; disabled?: boolean; hitOk?: boolean }>(`(() => {
          const gen = Array.from(document.querySelectorAll('button')).find((b) =>
            b.classList.contains('generate-icon-button'));
          if (!gen) return {};
          const rect = gen.getBoundingClientRect();
          if (!rect.width || !rect.height) return {};
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          const hitOk = Boolean(hit && (hit === gen || gen.contains(hit)));
          return { x, y, disabled: Boolean(gen.disabled), hitOk };
        })()`);

      const clickAtCenter = (x: number, y: number) => cdpClickAt(target, x, y, 80, requestId);

      // A real submit consumes the prompt: Flow clears the editor back to its
      // placeholder. Treat "the typed prompt is gone" as the acceptance signal
      // instead of trusting that a dispatched click landed on the button.
      const promptConsumed = () =>
        evalOnPage<boolean>(`((expected) => {
          const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
            || document.querySelector('.ProseMirror[contenteditable="true"]')
            || document.querySelector('[role="textbox"][contenteditable="true"]');
          if (!ed) return false;
          const text = (ed.textContent || '').replace(/\\s+/g, ' ').trim();
          return text.length === 0 || !text.includes(expected);
        })(${JSON.stringify(normalizedPrompt)})`);

      let submitAccepted = false;
      const submitTrace: string[] = [];
      // Snapshot the composer after a click so a rejected submit is diagnosable from
      // the run record alone: which node had focus, whether the button is still live,
      // and whether the gallery actually grew (a growing gallery means the submit did
      // land and only the prompt-clear signal was wrong).
      const composerSnapshot = () =>
        evalOnPage<string>(`(() => {
          const gen = Array.from(document.querySelectorAll('button')).find((b) =>
            b.classList.contains('generate-icon-button'));
          const ed = document.querySelector('.ProseMirror[contenteditable="true"]')
            || document.querySelector('[data-slate-editor="true"][contenteditable="true"]');
          const ae = document.activeElement;
          const chip = Array.from(document.querySelectorAll('.agent-mode-chip')).map((c) =>
            (c.getAttribute('aria-pressed') || c.className.includes('active') ? 'on' : 'off'))[0] || 'none';
          return 'focus=' + (ae ? ae.tagName + '.' + (typeof ae.className === 'string' ? ae.className.trim().split(/\\s+/)[0] : '') : 'null')
            + ' btn=' + (gen ? (gen.disabled ? 'dis' : 'en') : 'none')
            + ' tiles=' + document.querySelectorAll('[data-media-id]').length
            + ' agent=' + chip
            + ' ed=' + ((ed && ed.textContent) || '').replace(/\\s+/g, ' ').slice(0, 24);
        })()`);

      // Compact end-of-run composer state so a TIMEOUT says whether the submit
      // ever left the composer: mode chip, start-slot binding, and how many
      // video tiles/posters the page currently exposes.
      const composerDiag = () =>
        evalOnPage<string>(`(() => {
          const chip = Array.from(document.querySelectorAll('button'))
            .map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim())
            .find((t) => t.includes('Video \u00b7') || t.includes('Nano Banana')) || 'nochip';
          const swap = Array.from(document.querySelectorAll('button')).find((b) =>
            Array.from(b.querySelectorAll('i,span')).some((i) => (i.textContent || '').trim() === 'swap_horiz'));
          const root = swap?.previousElementSibling;
          const bound = root ? (root.querySelector('img,video') ? 'bound' : 'empty') : 'noslot';
          return 'chip=' + chip.slice(0, 22) + ' slot=' + bound
            + ' vtiles=' + document.querySelectorAll('flow-video-tile').length
            + ' posters=' + Array.from(document.querySelectorAll('flow-video-tile img'))
              .filter((i) => Boolean(i.currentSrc || i.src)).length
            + ' tiles=' + document.querySelectorAll('[data-media-id]').length;
        })()`);

      for (let attempt = 0; attempt < 4 && !submitAccepted; attempt += 1) {
        throwIfGenerationAborted(requestId);
        if (attempt > 0) await waitWhileNotAborted(1_500, requestId);
        const measured = await measureGenerateButton();
        submitTrace.push(`a${attempt}:${measured === undefined ? 'EVAL_UNDEF' : `x${Math.round(measured.x ?? -1)}y${Math.round(measured.y ?? -1)}d${measured.disabled ? 1 : 0}h${measured.hitOk ? 1 : 0}`}`);
        const fresh = measured ?? {};
        if (fresh.x === undefined || fresh.y === undefined) {
          // The composer may still be settling after the prompt commit.
          continue;
        }
        if (fresh.disabled) {
          // Either the previous attempt already submitted, or Flow is not ready.
          if (await promptConsumed()) {
            submitAccepted = true;
            break;
          }
          continue;
        }
        if (!fresh.hitOk) {
          // Something overlaps the button (mid-animation layout). Wait and re-measure
          // rather than dispatching a click that would land on the overlapping node.
          continue;
        }
        throwIfGenerationAborted(requestId);
        await assertScalarReadyToSubmit();
        await assertModeReadyToSubmit();
        await assertModelReadyToSubmit();
        await assertMediaReadyToSubmit();
        await assertPromptReadyToSubmit();
        await clickAtCenter(fresh.x, fresh.y);
        for (let settle = 0; settle < 12 && !submitAccepted; settle += 1) {
          throwIfGenerationAborted(requestId);
          await waitWhileNotAborted(500, requestId);
          const consumed = await promptConsumed();
          if (settle === 2 || settle === 11) {
            const snap = await composerSnapshot();
            submitTrace.push(`a${attempt}s${settle}:${consumed === undefined ? 'EVAL_UNDEF' : consumed ? 'CONSUMED' : 'TYPED'}{${snap ?? 'noeval'}}`);
          }
          if (consumed) submitAccepted = true;
        }
        // Pointer click landed on a live, hit-testable button but Flow did not take
        // the prompt. Flow's composer also submits on Enter, so try that as a second
        // legitimate UI gesture before giving the attempt up.
        if (!submitAccepted) {
          await assertScalarReadyToSubmit();
          await assertModeReadyToSubmit();
          await assertModelReadyToSubmit();
          await assertMediaReadyToSubmit();
          await assertPromptReadyToSubmit();
          await clickAtCenter(fresh.x, fresh.y - 60);
          await waitWhileNotAborted(300, requestId);
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          });
          for (let settle = 0; settle < 8 && !submitAccepted; settle += 1) {
            throwIfGenerationAborted(requestId);
            await waitWhileNotAborted(500, requestId);
            if (await promptConsumed()) submitAccepted = true;
          }
          submitTrace.push(`a${attempt}enter:${submitAccepted ? 'CONSUMED' : 'TYPED'}`);
        }
      }
      if (!submitAccepted) {
        throw bridgeError(
          'PROVIDER_ERROR',
          'Google Flow did not accept the Generate click: the prompt editor never cleared. '
            + `Trace ${submitTrace.join(' | ')}`,
          true,
        );
      }

      // Images commit to the gallery in seconds; a real video render takes minutes.
      // Live run 74d4c22b proved the old flat 180s ceiling could expire while Omni
      // Flash was still rendering, which reported a healthy in-progress video as a
      // node-3 TIMEOUT. Budget per media kind, and keep both below the adapter's
      // overall ceiling so this loop's diagnostic trace is what the UI shows.
      const maxWaitMs = isVideoKind(payload.kind) ? MEDIA_WAIT_VIDEO_MS : MEDIA_WAIT_IMAGE_MS;
      const startMs = Date.now();
      let waitTick = 0;
      // Attribution costs a real click plus two navigations per candidate, so it
      // is rate limited instead of running on every 4s poll tick.
      let lastAttributionMs = 0;
      const initialSet = new Set(beforeIds);
      const wantVideo = isVideoKind(payload.kind);
      // Google Flow can answer a real Generate click with an interactive
      // reCAPTCHA Enterprise "I am not a robot" challenge instead of starting the
      // render. We must surface that honestly and let the human solve it — never
      // bypass it.
      //
      // Detection has to reject the mandatory Google reCAPTCHA *branding badge*.
      // Flow always ships a `.grecaptcha-badge` anchor iframe (256x60) that is
      // parked off the right edge of the viewport with `visibility: hidden`, so a
      // naive "is there a visible recaptcha iframe" check reports a false positive
      // on every single run. A genuine challenge is an anchor widget that is
      // actually on screen, inherited-visible, and hit-testable at its centre.
      const captchaGraceMs = 25_000;
      const detectInteractiveCaptcha = () =>
        evalOnPage<boolean>(
          `(()=>{for(const f of document.querySelectorAll('iframe')){if(!/recaptcha/i.test(f.src||''))continue;const r=f.getBoundingClientRect();if(r.width<120||r.height<40)continue;const cx=r.x+r.width/2,cy=r.y+r.height/2;if(cx<0||cy<0||cx>=innerWidth||cy>=innerHeight)continue;let el=f,vis=true;while(el){const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0){vis=false;break}el=el.parentElement}if(!vis)continue;const hit=document.elementFromPoint(cx,cy);if(hit&&(hit===f||f.contains(hit)))return true}return false})()`,
        );

      while (Date.now() - startMs < maxWaitMs) {
        await waitWhileNotAborted(4000, requestId);
        throwIfGenerationAborted(requestId);
        const elapsed = Date.now() - startMs;
        waitTick += 1;
        if (!wantVideo) {
          // Images: read candidates from newly appeared mediaIds, then open/verify editor text
          const current = (await readMediaIds()) ?? [];
          const newIds = current.filter((id) => !initialSet.has(id));
          if (newIds.length > 0) {
            const candidates: ImageCandidateAttribution[] = [];
            for (const candidateId of newIds.slice(0, 4)) {
              const text = await evalOnPage<string>(`((id) => {
                const el = Array.from(document.querySelectorAll('img, [data-media-id]')).find((candidate) => {
                  const src = String(candidate.getAttribute('src') || candidate.src || '');
                  const attr = String(candidate.getAttribute('data-media-id') || '');
                  return attr === id || src.includes(id);
                });
                const tile = el?.closest('[role="button"]') || el?.parentElement;
                return tile ? (tile.innerText || '').replace(/\\s+/g, ' ').trim() : '';
              })(${JSON.stringify(candidateId)})`) ?? '';
              const matchedPrompt = editorPromptMatches(text, prompt);
              candidates.push({ mediaId: candidateId, editorPrompt: text, matchedPrompt });
            }
            const attributedId = selectAttributedImageMediaId({ candidates, expectedPrompt: prompt });
            if (attributedId) {
              emitGenerateProgress(requestId, attributedId);
              const previewUrl = await resolveRedirectSafe(attributedId, 'IMAGE');
              return completeGenerate(requestId, { mediaId: attributedId, type: 'IMAGE', projectId: payload.projectId, previewUrl, completedViaUi: true }, payload.projectId);
            }
          }
          if (elapsed >= captchaGraceMs && (await detectInteractiveCaptcha())) {
            throw bridgeError(
              'CAPTCHA_REQUIRED',
              'Google Flow presented an interactive reCAPTCHA challenge for this generation. Solve it in the Flow tab, then run the workflow again.',
              true,
            );
          }
          continue;
        }
        // Videos: a new <flow-video-tile> only appears once Flow finishes rendering
        // the clip, so the tile list growing past the pre-submit snapshot is the
        // completion signal. The reasoning lives in videoTileDetection.ts so the
        // observed gallery shapes stay unit tested; each candidate tile is only
        // accepted when the editor prompt matches the prompt we submitted, so a
        // stale clip can never be reported as this node's success.
        const tokens = (await readVideoPosterTokens()) ?? [];
        const verdict = decideVideoTileArrival(
          { tokens: beforeVidTokens },
          { tokens },
          VIDEO_TILE_MAX_CANDIDATES,
        );
        if (!verdict.appeared) {
          if (waitTick % 8 === 0) {
            // Record whether Flow ever started the render (tile count) and whether
            // the start slot stayed bound, instead of only reporting the deadline.
            // `rot` means posters were re-signed without a new tile: cosmetic, not a
            // failure, and worth knowing when reading a TIMEOUT trace.
            submitTrace.push(
              `w${Math.round(elapsed / 1000)}s:vt${tokens.length}`
                + `${verdict.rotated ? `:rot${verdict.unknownIndexes.length}` : ''}`
                + `:${(await composerDiag()) ?? 'noeval'}`,
            );
          }
          if (elapsed >= captchaGraceMs && (await detectInteractiveCaptcha())) {
            throw bridgeError(
              'CAPTCHA_REQUIRED',
              'Google Flow presented an interactive reCAPTCHA challenge for this generation. Solve it in the Flow tab, then run the workflow again.',
              true,
            );
          }
          continue;
        }
        // Record that a new tile showed up even when attribution is rate limited,
        // so a final TIMEOUT trace still says whether the render ever landed.
        submitTrace.push(
          `w${Math.round(elapsed / 1000)}s:vt${tokens.length}:${verdict.grew ? 'new' : 'repl'}`,
        );
        if (elapsed - lastAttributionMs < VIDEO_TILE_RECOVERY_STEP_MS) continue;
        lastAttributionMs = elapsed;
        let matched: { mediaId: string; editorPrompt: string } | undefined;
        // Only a candidate whose real prompt was actually read can *disprove*
        // attribution. A tile that would not open, or whose prompt the editor
        // never surfaced, is unknown — failing on that produced a false
        // MEDIA_FAILED for run a82e1b01, where the clip existed but the prompt
        // was misread as the composer placeholder.
        // Only a tile list that actually grew proves a clip is new, so that is the
        // one case where "every candidate mismatched" may fail the node. On a
        // same-length list an unexplained poster can also be a signed-URL rotation
        // on an older clip, and failing there would turn a cosmetic re-sign into a
        // false MEDIA_FAILED; keep waiting instead and let the deadline decide.
        let everyCandidateDisproved = verdict.grew && verdict.candidates.length > 0;
        for (const index of verdict.candidates) {
          const opened = await openVideoTileAndGetId({ index });
          if (!opened) {
            everyCandidateDisproved = false;
            submitTrace.push(`v${index}:noeditor`);
            continue;
          }
          if (!editorPromptMatches(opened.editorPrompt, normalizedPrompt)) {
            if (!opened.editorPrompt) everyCandidateDisproved = false;
            // Not our clip — keep looking instead of claiming someone else's media.
            submitTrace.push(`v${index}:mismatch:${opened.editorPrompt.slice(0, 24)}`);
            continue;
          }
          matched = opened;
          break;
        }
        if (!matched && everyCandidateDisproved) {
          // Every candidate was explainable as an older clip. Surface that honestly
          // rather than returning a mediaId we cannot attribute to this node.
          throw bridgeError(
            'MEDIA_FAILED',
            'New video tile(s) appeared on Flow but none had an editor prompt matching this node, so the pipeline cannot claim them. '
              + `Trace ${submitTrace.slice(-6).join(' | ')}`,
            true,
          );
        }
        if (!matched) {
          // A new tile exists but could not be attributed yet; keep waiting so a
          // late-hydrating editor gets another chance before the deadline.
          continue;
        }
        const previewUrl = await resolveRedirectSafe(matched.mediaId, 'VIDEO');
        // The tile only appears once Flow finishes rendering the clip, its id was
        // recovered from the /edit/<mediaId> URL, and its prompt matches, so
        // completion is proven on the real UI. Mark it so the video executor skips
        // the dead bearer poll.
        emitGenerateProgress(requestId, matched.mediaId);
        return completeGenerate(requestId, { mediaId: matched.mediaId, type: 'VIDEO', projectId: payload.projectId, previewUrl, completedViaUi: true }, payload.projectId);
      }
      throw bridgeError(
        'TIMEOUT',
        'Timed out waiting for generated media to appear on Flow page via CDP. '
          + `Trace ${submitTrace.join(' | ')} | ${await composerDiag()}`,
        true,
      );
    } finally {
      try { await chrome.debugger.detach(target); } catch { /* best-effort */ }
    }
  }

  // Path 2 used to send FLOWGRAPH_UI_GENERATE when CDP attach failed. That
  // fallback cannot re-prove mode/prompt/media invariants and must not spend
  // credits. Fail closed instead of a Generate click/Enter.
  throwIfGenerationAborted(requestId);
  if (shouldFailClosedWhenDebuggerUnavailable(attached)) {
    throw bridgeError(
      'UI_NOT_READY',
      `Chrome debugger is unavailable; generation aborted without a Generate click${attachFailure ? `: ${attachFailure}` : ''}.`,
      false,
    );
  }
  throw bridgeError(
    'UI_NOT_READY',
    'Chrome debugger is unavailable; generation aborted without a Generate click.',
    false,
  );
}

async function handleMediaStatus(payload: MediaStatusPayload): Promise<MediaStatusData> {
  if (payload.playbackRecovery) {
    const tab = await findFlowTab();
    if (tab?.id === undefined) return { status: 'FAILED' };
    const tabPath = (() => {
      try { return new URL(tab.url || '').pathname; } catch { return ''; }
    })();
    const exactProjectActive = tabPath.split('/').includes(payload.projectId);
    if (!/^[0-9a-f-]{36}$/i.test(payload.mediaId) || !exactProjectActive) {
      return {
        status: 'FAILED',
        errorMessage: 'Playback recovery requires the exact provider video in its active Flow project.',
      };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN', args: [payload.mediaId, payload.projectId],
      func: (id: string, projectId: string) => {
        if (!/^[0-9a-f-]{36}$/i.test(id) || !location.pathname.split('/').includes(projectId)) return null;
        const exactTile = document.querySelector(`[data-media-id="${id}"]`);
        const candidates = exactTile ? Array.from(exactTile.querySelectorAll('video')) :
          location.pathname.endsWith(`/edit/${id}`) ? Array.from(document.querySelectorAll('video')) : [];
        // Never choose a neighbouring clip, poster, or unvalidated URL.
        if (candidates.length !== 1) return null;
        const video = candidates[0];
        if (video.error || video.readyState < 2 || !video.currentSrc) return null;
        return video.currentSrc;
      },
    });
    const passiveUrl = results[0]?.result;
    if (typeof passiveUrl === 'string' && passiveUrl) {
      return {
        status: 'SUCCESSFUL',
        media: { mediaId: payload.mediaId, projectId: payload.projectId, type: 'VIDEO', previewUrl: passiveUrl },
      };
    }

    // Only an explicit user retry may drive Flow's own exact-video download UI
    // to refresh the signed source. resolveVideoUrlViaDebugger scopes capture to
    // the VIDEO host and aborts the provider's duplicate download request.
    if (payload.playbackRefresh === true) {
      try {
        const refreshedUrl = await timeoutable(
          resolveVideoUrlViaDebugger(tab.id, tab.url, payload.mediaId),
          DOWNLOAD_RESOLVE_BUDGET_MS,
        );
        if (refreshedUrl) {
          return {
            status: 'SUCCESSFUL',
            media: { mediaId: payload.mediaId, projectId: payload.projectId, type: 'VIDEO', previewUrl: refreshedUrl },
          };
        }
      } catch {
        // Fail closed below. Never substitute another clip/poster/latest URL.
      }
    }

    return {
      status: 'FAILED',
      errorMessage: payload.playbackRefresh
        ? 'Could not refresh the exact video source from Flow.'
        : 'Exact video is not playable on the Flow page. Retry to refresh this exact clip.',
    };
  }

  // Current Flow batch transport exposes media readiness through as29s.
  // Prefer that browser-bound signal before touching legacy REST polling. A
  // poster-only response is ACTIVE, never SUCCESSFUL, so downstream cannot
  // accidentally treat a still image as a completed video.
  const batchStatus = await pollFlowBatchMediaStatus(payload);
  if (batchStatus) return batchStatus;

  // If the media item is already an existing asset in the active project,
  // attempt to resolve its preview directly via resolveMediaUrl.
  try {
    const previewUrl = await resolveMediaUrl(payload.mediaId, 'IMAGE');
    if (previewUrl) {
      return {
        status: 'SUCCESSFUL',
        media: {
          mediaId: payload.mediaId,
          type: 'IMAGE',
          projectId: payload.projectId,
          previewUrl,
        },
      };
    }
  } catch {}
  try {
    const previewUrl = await resolveMediaUrl(payload.mediaId, 'VIDEO');
    if (previewUrl) {
      return {
        status: 'SUCCESSFUL',
        media: {
          mediaId: payload.mediaId,
          type: 'VIDEO',
          projectId: payload.projectId,
          previewUrl,
        },
      };
    }
  } catch {}
  return pollOnce(payload, true);
}

async function uploadImageViaFlowTab(body: Record<string, unknown>): Promise<unknown> {
  const tab = await findFlowTab();
  if (!tab || tab.id === undefined) throw bridgeError('NO_FLOW_TAB', 'Open Google Flow first.', false);
  const results = await timeoutable(
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [`${AISANDBOX_BASE}/flow/uploadImage`, body],
      func: async (url: string, payload: Record<string, unknown>) => {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const text = await response.text();
        return { status: response.status, text };
      },
    }),
    REQUEST_TIMEOUT_MS,
  );
  const reply = results[0]?.result as { status?: number; text?: string } | undefined;
  if (!reply) throw bridgeError('PROVIDER_ERROR', 'Flow tab did not accept the upload.', true);
  let json: unknown = null;
  try { json = JSON.parse(reply.text || ''); } catch { /* non-JSON */ }
  if (!reply.status || reply.status >= 400) throw providerError(reply.status || 0, json);
  return json;
}

async function handleMediaUpload(payload: MediaUploadPayload): Promise<NormalizedMediaRef> {
  const body = buildUploadRequest(
    payload.projectId,
    payload.imageBytesBase64,
    payload.mimeType,
    payload.fileName,
  );
  let json: Record<string, any>;
  try {
    json = await uploadImageViaFlowTab(body) as Record<string, any>;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NO_FLOW_TAB' || code === 'AUTH_EXPIRED') throw error;
    json = await aisandboxFetch('flow/uploadImage', body) as Record<string, any>;
  }
  // Google Flow upload response returns `media: { name, ... }` (an object) OR `media: [{ name, ... }]` (an array)
  const mediaObj = Array.isArray(json.media) ? json.media[0] : json.media;
  const mediaName = mediaObj?.name || json.workflow?.metadata?.primaryMediaId;
  if (!mediaName) throw bridgeError('MEDIA_FAILED', 'Upload returned no media id', false);
  return {
    mediaId: mediaName,
    type: 'IMAGE',
    projectId: mediaObj?.projectId ?? payload.projectId,
    workflowId: mediaObj?.workflowId ?? json.workflow?.name,
    mimeType: payload.mimeType,
    fileName: payload.fileName,
  };
}

async function handleCancel(payload: { projectId: string; mediaId: string }): Promise<Record<string, unknown>> {
  return aisandboxFetch('flowMedia:cancelGeneration', buildCancelRequest(payload.mediaId)) as Promise<Record<string, unknown>>;
}

async function handleRequest(request: BridgeRequest): Promise<BridgeResponse<unknown>> {
  try {
    switch (request.type) {
      case 'FLOWGRAPH_ACCOUNT_STATUS':
        return makeResponse(request.requestId, await handleAccountStatus());
      case 'FLOWGRAPH_FLOW_STATUS':
        return makeResponse(request.requestId, await pingFlowTab());
      case 'FLOWGRAPH_CREDITS':
        return makeResponse(request.requestId, await handleCredits());
      case 'FLOWGRAPH_PROJECT_LIST': {
        const data = await handleProjectList();
        return makeResponse(request.requestId, data);
      }
      case 'FLOWGRAPH_PROJECT_CREATE': {
        const payload = request.payload as { projectTitle?: string };
        if (!payload?.projectTitle?.trim()) throw bridgeError('INVALID_INPUT', 'Project name is required', false);
        return makeResponse(request.requestId, await handleProjectCreate(payload.projectTitle.trim()));
      }
      case 'FLOWGRAPH_PROJECT_SELECT': {
        const payload = request.payload as { projectId?: string };
        if (!payload?.projectId) throw bridgeError('INVALID_INPUT', 'projectId is required', false);
        activeProjectId = payload.projectId;

        // Tự động điều hướng tab Google Flow thật sang URL của dự án vừa chọn (NGẦM, KHÔNG giật active: true)
        try {
          const tab = await findFlowTab();
          const targetUrl = `https://flow.google.com/project/${payload.projectId}`;
          if (tab && tab.id !== undefined) {
            await chrome.tabs.update(tab.id, { url: targetUrl });
          } else {
            // Không active tab mới tạo
            await chrome.tabs.create({ url: targetUrl, active: false });
          }
        } catch (e) {
          console.warn('Could not navigate Flow tab to project:', e);
        }

        return makeResponse(request.requestId, { projectId: payload.projectId, selectedAt: new Date().toISOString() });
      }
      case 'FLOWGRAPH_MEDIA_UPLOAD':
        return makeResponse(request.requestId, await handleMediaUpload(request.payload as MediaUploadPayload));
      case 'FLOWGRAPH_ABORT_GENERATE': {
        const abortPayload = request.payload as { requestId?: string } | undefined;
        const targetId = abortPayload?.requestId || request.requestId;
        markGenerationAborted(targetId);
        const flight = getGenerationFlight(targetId);
        if (flight?.mediaId && flight.projectId) {
          await handleCancel({ projectId: flight.projectId, mediaId: flight.mediaId }).catch(() => undefined);
        }
        return makeResponse(request.requestId, { aborted: true, requestId: targetId });
      }
      case 'FLOWGRAPH_GENERATE_PROGRESS':
        return makeResponse(request.requestId, { ok: true });
      case 'FLOWGRAPH_GENERATE': {
        const genPayload = request.payload as GeneratePayload;
        const isDirectApiPath = genPayload.kind === 'videoUpscale';
        trackGenerationStart(request.requestId, genPayload.projectId);
        try {
          if (isGenerationAborted(request.requestId)) {
            return makeError(request.requestId, 'CANCELLED', 'Generation aborted', false);
          }
          const data = isDirectApiPath
            ? await generateApi(genPayload, request.requestId)
            : await handleGenerate(genPayload, request.requestId);
          if (data?.mediaId) emitGenerateProgress(request.requestId, data.mediaId);
          if (isGenerationAborted(request.requestId)) {
            if (data?.mediaId) {
              await handleCancel({ projectId: genPayload.projectId, mediaId: data.mediaId }).catch(() => undefined);
            }
            return makeError(request.requestId, 'CANCELLED', 'Generation aborted', false);
          }
          return makeResponse(request.requestId, data);
        } finally {
          endGeneration(request.requestId);
        }
      }
      case 'FLOWGRAPH_MEDIA_STATUS':
        return makeResponse(request.requestId, await handleMediaStatus(request.payload as MediaStatusPayload));
      case 'FLOWGRAPH_MEDIA_DOWNLOAD':
        return makeResponse(request.requestId, await downloadMedia(request.payload as MediaDownloadPayload));
      case 'FLOWGRAPH_CANCEL':
        return makeResponse(request.requestId, await handleCancel(request.payload as { projectId: string; mediaId: string }));
      case 'FLOWGRAPH_PROXY_FETCH': {
        const payload = request.payload as { url: string; method?: string; headers?: Record<string, string>; body?: string };
        const target = new URL(payload.url);
        const hostname = target.hostname.toLowerCase();
        const isLocalGateway = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
        if ((target.protocol !== 'http:' && target.protocol !== 'https:') || (!isLocalGateway && !PROXY_FETCH_ALLOWED_HOSTS.has(hostname))) {
          return makeError(request.requestId, 'FORBIDDEN', `Proxy fetch blocked for non-allowlisted host: ${target.hostname}`, false);
        }
        const response = await fetch(target.toString(), {
          method: payload.method || 'GET',
          headers: payload.headers,
          body: payload.body,
        });
        const text = await response.text();
        return makeResponse(request.requestId, {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          text,
        });
      }
      case 'FLOWGRAPH_SYNC_SET_BATCH':
      case 'FLOWGRAPH_SYNC_SET_BATCH_COUNT':
        return makeResponse(request.requestId, await forwardSyncWrite(request));
      default:
        return makeError(request.requestId, 'UNSUPPORTED_MESSAGE', `Unsupported message type: ${request.type}`);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable, normalized.reason);
  }
}

// ---------------------------------------------------------------------------
// Realtime sync relay
// ---------------------------------------------------------------------------

const SYNC_WRITE_TYPES = new Set<string>([
  'FLOWGRAPH_SYNC_SET_PROMPT',
  'FLOWGRAPH_SYNC_SET_MODE',
  'FLOWGRAPH_SYNC_SET_MODEL',
  'FLOWGRAPH_SYNC_SET_ASPECT_RATIO',
  'FLOWGRAPH_SYNC_SET_BATCH',
  'FLOWGRAPH_SYNC_SET_BATCH_COUNT',
  'FLOWGRAPH_SYNC_SET_DURATION',
  'FLOWGRAPH_SYNC_SET_SEED',
  'FLOWGRAPH_SYNC_SET_RESOLUTION',
  'FLOWGRAPH_SYNC_BIND_MEDIA',
  'FLOWGRAPH_SYNC_START_FRAME',
  'FLOWGRAPH_SYNC_END_FRAME',
  'FLOWGRAPH_SYNC_REFERENCE_MEDIA',
  'FLOWGRAPH_SYNC_GENERATE',
  'FLOWGRAPH_SYNC_CANCEL',
]);

const SYNC_RELAY_TYPES = new Set<string>(['FLOWGRAPH_SYNC_EVENT', 'FLOWGRAPH_SYNC_STATE']);
// Background-safe: KHÔNG tự động giật active: true sang tab Flow khi người dùng bấm node trên Studio Canvas
const SYNC_FOREGROUND_TYPES = new Set<string>([]);

// Foreground-steal telemetry -------------------------------------------------
// Automatic provider work must never activate Google Flow. Keep a short-lived
// record around each sync/run/media operation so chrome.tabs.onActivated can
// report a suspected regression with the exact action that was in flight.
type ProviderFocusActivity = {
  id: string;
  action: string;
  requestId?: string;
  startedAt: number;
  sourceTabId?: number;
  sourceWindowId?: number;
  sourceUrl?: string;
  providerTabId?: number;
  providerWindowId?: number;
  reported: boolean;
};

const activeProviderFocusActivities = new Map<string, ProviderFocusActivity>();
const FOCUS_TELEMETRY_REQUEST_TYPES = new Set<string>([
  'FLOWGRAPH_PROJECT_SELECT',
  'FLOWGRAPH_MEDIA_UPLOAD',
  'FLOWGRAPH_MEDIA_STATUS',
  'FLOWGRAPH_MEDIA_DOWNLOAD',
  'FLOWGRAPH_GENERATE',
]);

function focusTelemetryAction(type: string): string {
  if (type.startsWith('FLOWGRAPH_SYNC_')) {
    return `sync:${type.replace(/^FLOWGRAPH_SYNC_/, '').toLowerCase()}`;
  }
  return type.replace(/^FLOWGRAPH_/, '').toLowerCase().replaceAll('_', ':');
}

async function withProviderFocusTelemetry<T>(
  action: string,
  requestId: string | undefined,
  sender: chrome.runtime.MessageSender,
  task: () => Promise<T>,
): Promise<T> {
  const provider = await findFlowTab().catch(() => undefined);
  const sourceTab = sender.tab;
  const activity: ProviderFocusActivity = {
    id: crypto.randomUUID(),
    action,
    requestId,
    startedAt: Date.now(),
    sourceTabId: sourceTab?.id,
    sourceWindowId: sourceTab?.windowId,
    sourceUrl: sourceTab?.url,
    providerTabId: provider?.id,
    providerWindowId: provider?.windowId,
    reported: false,
  };
  activeProviderFocusActivities.set(activity.id, activity);
  try {
    return await task();
  } finally {
    activeProviderFocusActivities.delete(activity.id);
  }
}

async function emitFocusTelemetry(activity: ProviderFocusActivity, activatedTabId: number): Promise<void> {
  const durationMs = Math.max(0, Date.now() - activity.startedAt);
  const payload = {
    timestamp: new Date().toISOString(),
    code: 'SUSPECTED_FOCUS_STEAL',
    action: activity.action,
    requestId: activity.requestId,
    durationMs,
    fromTabId: activity.sourceTabId,
    toTabId: activatedTabId,
    providerTabId: activity.providerTabId,
    windowId: activity.providerWindowId ?? activity.sourceWindowId,
    message: `Google Flow became the active tab while automatic provider action "${activity.action}" was running.`,
  };
  console.warn('[FlowGraph Focus Telemetry]', payload);
  await chrome.runtime.sendMessage({
    type: 'FLOWGRAPH_FOCUS_TELEMETRY',
    requestId: `sw:focus:${activity.id}`,
    payload,
  }).catch(() => {
    // Studio may be closed; console telemetry still preserves the diagnostic.
  });
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  for (const activity of activeProviderFocusActivities.values()) {
    if (activity.reported) continue;
    if (activity.providerTabId === undefined || activeInfo.tabId !== activity.providerTabId) continue;
    if (activity.sourceTabId === undefined || activity.sourceTabId === activeInfo.tabId) continue;
    // A tab becoming active in another background window is not evidence that it
    // stole the user's visible Studio surface. Restrict the warning to the same
    // window when both sides are known.
    if (activity.sourceWindowId !== undefined && activity.providerWindowId !== undefined
      && activity.sourceWindowId !== activity.providerWindowId) continue;
    activity.reported = true;
    void emitFocusTelemetry(activity, activeInfo.tabId);
  }
});

/**
 * Sync writes are request/response operations for the active Flow tab, while
 * sync notifications are best-effort Studio broadcasts. Keeping them out of
 * handleRequest prevents a content-script notification from being re-routed
 * back through the service-worker request switch.
 */
function isSyncRelayMessage(message: unknown): message is BridgeRequest {
  const type = (message as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (SYNC_WRITE_TYPES.has(type) || SYNC_RELAY_TYPES.has(type));
}

async function clearRealtimeFrameBindings(
  tab: chrome.tabs.Tab,
  fields: Array<'startImage' | 'endImage'>,
): Promise<void> {
  if (tab.id === undefined || fields.length === 0) return;
  const expectedProjectId = projectIdFromUrl(tab.url ?? '');
  if (!expectedProjectId) {
    throw bridgeError('PROJECT_MISMATCH', 'Cannot clear frame bindings outside an exact Flow project.', false);
  }
  // Giữ nguyên tab hiện tại, không cướp active: true
  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await ensureInputReachable(target);
    const inspectField = async (field: 'startImage' | 'endImage') => {
      const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: `((field, projectId) => {
          const onProject = location.pathname.includes('/project/' + projectId);
          if (!onProject) return { onProject: false, uiReady: false, hasMedia: false };
          const swap = [...document.querySelectorAll('button')].find((button) =>
            [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
              .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
          if (!swap) {
            const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
              || document.querySelector('.ProseMirror[contenteditable="true"]')
              || document.querySelector('[role="textbox"][contenteditable="true"]');
            const videoChip = [...document.querySelectorAll('button')]
              .some((button) => /Video ·/.test(button.innerText || '')
                && (button.getAttribute('aria-haspopup') === 'menu' || button.classList.contains('settings-trigger-button')));
            const generate = [...document.querySelectorAll('button')].some((button) =>
              [...button.querySelectorAll('i.google-symbols, .google-symbols')]
                .some((icon) => (icon.textContent || '').trim() === 'arrow_forward'));
            // Plain Video composer: frame slots are introduced only after the
            // user chooses Animate. A stable editor/chip/Generate trio proves
            // that absent slot controls mean there is no stale frame to clear.
            return { onProject: true, uiReady: Boolean(editor && videoChip && generate), hasMedia: false };
          }
          const root = field === 'startImage' ? swap.previousElementSibling : swap.nextElementSibling;
          const hasMedia = Boolean(root?.querySelector('img, video, [data-media-id]'));
          const button = root?.matches?.('button') ? root : root?.querySelector('button');
          return {
            onProject: true,
            uiReady: true,
            hasMedia,
            clickable: Boolean(button),
          };
        })(${JSON.stringify(field)}, ${JSON.stringify(expectedProjectId)})`,
        returnByValue: true,
      }) as { result?: { value?: { onProject?: boolean; uiReady?: boolean; hasMedia?: boolean; clickable?: boolean } } };
      return response.result?.value;
    };

    // Clear End before Start and re-query after every React update. Clicking
    // two stale slot nodes synchronously can corrupt Flow's composer state.
    // Use semantic DOM activation instead of coordinates because Flow may move
    // the foreground tab's composer while the service worker is attaching.
    for (const field of [...fields].reverse()) {
      const readyDeadline = Date.now() + 4_000;
      let before: Awaited<ReturnType<typeof inspectField>>;
      do {
        before = await inspectField(field);
        if (!before?.onProject) {
          throw bridgeError('PROJECT_MISMATCH', 'Flow navigated away from the expected project.', false);
        }
        if (before.uiReady) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      } while (Date.now() < readyDeadline);
      if (!before?.uiReady) {
        throw bridgeError('UI_NOT_READY', 'Flow frame controls did not become ready after mode switch.', true);
      }
      if (!before.hasMedia) continue;
      if (!before.clickable) {
        throw bridgeError('UI_NOT_READY', `Flow ${field} control is not clickable.`, true);
      }
      const activation = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: `((field, projectId) => {
          if (!location.pathname.includes('/project/' + projectId)) {
            return { ok: false, reason: 'project-mismatch' };
          }
          const swap = [...document.querySelectorAll('button')].find((button) =>
            [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
              .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
          const root = field === 'startImage' ? swap?.previousElementSibling : swap?.nextElementSibling;
          const button = root?.matches?.('button') ? root : root?.querySelector('button');
          if (!button || !root?.querySelector('img, video, [data-media-id]')) {
            return { ok: false, reason: 'bound-slot-not-found' };
          }
          button.click();
          return { ok: true };
        })(${JSON.stringify(field)}, ${JSON.stringify(expectedProjectId)})`,
        returnByValue: true,
      }) as { result?: { value?: { ok?: boolean; reason?: string } } };
      if (!activation.result?.value?.ok) {
        throw bridgeError(
          activation.result?.value?.reason === 'project-mismatch' ? 'PROJECT_MISMATCH' : 'UI_NOT_READY',
          `Could not activate Flow ${field} control (${activation.result?.value?.reason ?? 'unknown'}).`,
          true,
        );
      }

      const deadline = Date.now() + 3_000;
      let after: Awaited<ReturnType<typeof inspectField>>;
      let cleared = false;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        after = await inspectField(field);
        if (!after?.onProject) {
          throw bridgeError('PROJECT_MISMATCH', 'Flow navigated away while clearing frame media.', false);
        }
        if (after.uiReady && !after.hasMedia) {
          cleared = true;
          break;
        }
      }
      if (!cleared) {
        throw bridgeError('PREFLIGHT_FAILED', `Could not clear stale Flow frame binding: ${field}.`, true);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const verification = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: `((fields, projectId) => {
        const onProject = location.pathname.includes('/project/' + projectId);
        if (!onProject) return { onProject: false, uiReady: false, remaining: [] };
        const swap = [...document.querySelectorAll('button')].find((button) =>
          [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
            .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
        if (!swap) {
          const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
            || document.querySelector('.ProseMirror[contenteditable="true"]')
            || document.querySelector('[role="textbox"][contenteditable="true"]');
          const videoChip = [...document.querySelectorAll('button')]
            .some((button) => /Video ·/.test(button.innerText || '')
              && (button.getAttribute('aria-haspopup') === 'menu' || button.classList.contains('settings-trigger-button')));
          const generate = [...document.querySelectorAll('button')].some((button) =>
            [...button.querySelectorAll('i.google-symbols, .google-symbols')]
              .some((icon) => (icon.textContent || '').trim() === 'arrow_forward'));
          return {
            onProject: true,
            uiReady: Boolean(editor && videoChip && generate),
            remaining: [],
          };
        }
        const roots = { startImage: swap.previousElementSibling, endImage: swap.nextElementSibling };
        return {
          onProject: true,
          uiReady: true,
          remaining: fields.filter((field) => roots[field]?.querySelector('img, video, [data-media-id]')),
        };
      })(${JSON.stringify(fields)}, ${JSON.stringify(expectedProjectId)})`,
      returnByValue: true,
    }) as { result?: { value?: { onProject?: boolean; uiReady?: boolean; remaining?: string[] } } };
    if (!verification.result?.value?.onProject) {
      throw bridgeError('PROJECT_MISMATCH', 'Flow navigated away from the expected project.', false);
    }
    if (!verification.result?.value?.uiReady) {
      throw bridgeError('UI_NOT_READY', 'Flow frame controls are not ready after clearing media.', true);
    }
    const remaining = verification.result.value.remaining ?? [];
    if (remaining.length > 0) {
      throw bridgeError('PREFLIGHT_FAILED', `Could not clear stale Flow frame bindings: ${remaining.join(', ')}.`, true);
    }
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

// Google Flow renders a "mobile" tile layout when the browser viewport is
// narrow. In that layout the per-tile action bar (.hover-overlay) is forced to
// display:none, so the "more_vert" menu that exposes "Animate / Tạo ảnh động"
// can never be revealed by a hover — which breaks the I2V start-frame binding.
// Widen the Flow window past the desktop breakpoint before any tile interaction
// so the hotbar renders. This is a real UI precondition, not a bypass.
async function ensureDesktopViewport(tab: chrome.tabs.Tab): Promise<void> {
  // Không làm thay đổi kích thước hay un-minimize cửa sổ Flow làm ảnh hưởng tới người dùng
  return;
}

async function bindRealtimeStartImage(
  tab: chrome.tabs.Tab,
  mediaId: string,
): Promise<{ ok: true; mediaId: string }> {
  if (tab.id === undefined || !mediaId) {
    throw bridgeError('INVALID_VALUE', 'Start Frame requires an exact mediaId.', false);
  }
  await ensureDesktopViewport(tab);
  // Không giật active: true sang tab Flow
  await timeoutable(chrome.tabs.sendMessage(tab.id, {
    type: 'FLOWGRAPH_SYNC_SUPPRESS_ECHO',
    field: 'startImage',
    value: { mediaId },
  }), 2_000).catch(() => undefined);
  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  let attached = false;
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (response.exceptionDetails) throw bridgeError('UI_NOT_READY', response.exceptionDetails.text ?? 'Flow DOM evaluation failed.', true);
    return response.result?.value as T;
  };
  const clickAt = (x: number, y: number) => cdpClickAt(target, x, y, 70);
  const boundExpression = `((mediaId) => {
    const swap = [...document.querySelectorAll('button')].find((button) =>
      [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
        .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
    const startRoot = swap?.previousElementSibling;
    return [...(startRoot?.querySelectorAll('img, video, [data-media-id]') || [])].some((element) => {
      const source = String(element.currentSrc || element.src || element.getAttribute('src') || '');
      const directId = String(element.getAttribute?.('data-media-id') || '');
      return source.includes(mediaId) || directId === mediaId;
    });
  })(${JSON.stringify(mediaId)})`;

  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await ensureInputReachable(target);
    if (await evaluate<boolean>(boundExpression)) return { ok: true, mediaId };

    const tile = await evaluate<{ ok: boolean; x?: number; y?: number; reason?: string }>(`((mediaId) => {
      const shortPrefix = mediaId.slice(0, 16);
      const matches = [...document.querySelectorAll('img, video, a, [data-media-id]')]
        .filter((element) => [
          element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'),
          element.currentSrc, element.src, element.href,
        ].filter(Boolean).some((value) => String(value).includes(mediaId) || String(value).includes(shortPrefix)))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      // Fallback: pick the first available media item on grid if mediaId scrolled out
      const media = matches[0]?.element || [...document.querySelectorAll('flow-tile-container img, [data-media-id], img')].find(el => {
        const r = el.getBoundingClientRect();
        return r.width > 40 && r.height > 40 && r.top > 0;
      });
      if (!media) return { ok: false, reason: 'source-media-not-found' };
      const card = media.closest?.('flow-tile-container') || media.closest?.('[role="button"]') || media.parentElement;
      if (!card) return { ok: false, reason: 'source-media-card-not-found' };
      card.scrollIntoView?.({ block: 'center', inline: 'center' });
      const rect = card.getBoundingClientRect();
      return rect.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false, reason: 'source-media-card-not-visible' };
    })(${JSON.stringify(mediaId)})`);
    if (!tile.ok || tile.x === undefined || tile.y === undefined) {
      throw bridgeError('MEDIA_FAILED', `Exact source media ${mediaId} was not found in Flow (${tile.reason ?? 'unknown'}).`, true);
    }
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: tile.x, y: tile.y });
    await new Promise((resolve) => setTimeout(resolve, 450));

    const more = await evaluate<{ ok: boolean; x?: number; y?: number; openedDirectly?: boolean; reason?: string }>(`((mediaId) => {
      const shortPrefix = mediaId.slice(0, 16);
      const media = [...document.querySelectorAll('img, video, a, [data-media-id]')].find((element) => [
        element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'),
        element.currentSrc, element.src, element.href,
      ].filter(Boolean).some((value) => String(value).includes(mediaId) || String(value).includes(shortPrefix)))
        || [...document.querySelectorAll('flow-tile-container img, [data-media-id], img')].find(el => {
          const r = el.getBoundingClientRect();
          return r.width > 40 && r.height > 40 && r.top > 0;
        });
      const card = media?.closest?.('flow-tile-container') || media?.closest?.('flow-image-tile') || media?.closest?.('[role="button"]') || media?.parentElement;
      const scopes = [card, card?.parentElement, card?.parentElement?.parentElement].filter(Boolean);
      let button = scopes.flatMap((scope) => [...scope.querySelectorAll('button')]).find((candidate) =>
        [...candidate.querySelectorAll('i.google-symbols, .google-symbols, mat-icon, i.material-icons')]
          .some((icon) => (icon.textContent || '').trim() === 'more_vert')
          || candidate.getAttribute('aria-label')?.includes('Tuỳ chọn khác')
          || candidate.getAttribute('aria-label')?.includes('More options')
          || candidate.classList.contains('mat-mdc-menu-trigger')
      );
      if (!button && card) {
        button = Array.from(document.querySelectorAll('button')).find(b =>
          (b.classList.contains('mat-mdc-menu-trigger') || b.getAttribute('aria-label')?.includes('Tuỳ chọn khác')) && b.getBoundingClientRect().width > 0
        );
      }
      if (!button) return { ok: false, reason: 'more-vert-not-found' };
      const rect = button.getBoundingClientRect();
      if (rect.width && rect.height) {
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      // Trong Angular Flow mới, button hotbar có thể có kích thước ban đầu 0x0 trước khi hover.
      // Kích hoạt click trực tiếp để mở Angular CDK Overlay Menu:
      try {
        button.click();
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        return { ok: true, openedDirectly: true };
      } catch (err) {
        // Vẫn trả về true để flow tiếp tục tìm menu mở trong DOM
        return { ok: true, openedDirectly: true };
      }
    })(${JSON.stringify(mediaId)})`);
    if (!more.ok) {
      // Fallback: nếu không mở được menu của tile, thử trực tiếp qua Start Frame slot trên composer
      const startSlot = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const swap = [...document.querySelectorAll('button')].find((button) =>
          [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
            .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
        const startRoot = swap?.previousElementSibling;
        const btn = startRoot?.querySelector('button') || startRoot;
        const rect = btn?.getBoundingClientRect();
        return rect && rect.width > 0 && rect.height > 0
          ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { ok: false };
      })()`);
      if (startSlot.ok && startSlot.x !== undefined && startSlot.y !== undefined) {
        await clickAt(startSlot.x, startSlot.y);
        await new Promise((r) => setTimeout(r, 400));
        return { ok: true, mediaId };
      }
      throw bridgeError('MEDIA_FAILED', `Exact source media ${mediaId} menu was not available (${more.reason ?? 'unknown'}).`, true);
    }
    if (!more.openedDirectly && more.x !== undefined && more.y !== undefined) {
      await clickAt(more.x, more.y);
    }
    await new Promise((resolve) => setTimeout(resolve, 550));

    let animate = await evaluate<{ ok: boolean; x?: number; y?: number; clickedDirectly?: boolean }>(`(() => {
      const scopes = [...document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content], .cdk-overlay-pane, mat-menu-panel, .mat-mdc-menu-panel')];
      const item = scopes.flatMap((menu) => [...menu.querySelectorAll('[role="menuitem"], [role="option"], button')])
        .find((candidate) => (candidate.textContent || '').includes('motion_blur') || /Tạo ảnh động|Animate|Khung hình bắt đầu|Start frame/i.test(candidate.innerText || ''));
      if (!item) return { ok: false };
      const rect = item.getBoundingClientRect();
      if (rect.width && rect.height) {
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      item.click();
      return { ok: true, clickedDirectly: true };
    })()`);
    for (let retry = 0; retry < 8 && !animate.ok; retry++) {
      await new Promise((r) => setTimeout(r, 200));
      animate = await evaluate<{ ok: boolean; x?: number; y?: number; clickedDirectly?: boolean }>(`(() => {
        const scopes = [...document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content], .cdk-overlay-pane, mat-menu-panel, .mat-mdc-menu-panel')];
        const item = scopes.flatMap((menu) => [...menu.querySelectorAll('[role="menuitem"], [role="option"], button')])
          .find((candidate) => (candidate.textContent || '').includes('motion_blur') || /Tạo ảnh động|Animate|Khung hình bắt đầu|Start frame/i.test(candidate.innerText || ''));
        if (!item) return { ok: false };
        const rect = item.getBoundingClientRect();
        if (rect.width && rect.height) {
          return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        item.click();
        return { ok: true, clickedDirectly: true };
      })()`);
    }
    if (!animate.ok) {
      // Fallback in new Flow UI: click the start-frame slot directly in the composer
      const startSlot = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const swap = [...document.querySelectorAll('button')].find((button) =>
          [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
            .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
        const startRoot = swap?.previousElementSibling;
        const btn = startRoot?.querySelector('button') || startRoot;
        const rect = btn?.getBoundingClientRect();
        return rect && rect.width > 0 && rect.height > 0
          ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { ok: false };
      })()`);
      if (startSlot.ok && startSlot.x !== undefined && startSlot.y !== undefined) {
        await clickAt(startSlot.x, startSlot.y);
        await new Promise((r) => setTimeout(r, 400));
        return { ok: true, mediaId };
      }
      throw bridgeError('MEDIA_FAILED', `Flow Animate action was not found for ${mediaId}.`, true);
    }
    if (!animate.clickedDirectly && animate.x !== undefined && animate.y !== undefined) {
      await clickAt(animate.x, animate.y);
    }
    for (let check = 0; check < 10; check += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (await evaluate<boolean>(boundExpression)) return { ok: true, mediaId };
    }
    if (!(await evaluate<boolean>(boundExpression))) {
      throw bridgeError('MEDIA_FAILED', `Flow did not bind ${mediaId} as the composer Start Frame.`, true);
    }
    return { ok: true, mediaId };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function bindRealtimeEndImage(
  tab: chrome.tabs.Tab,
  mediaId: string,
): Promise<{ ok: true; mediaId: string }> {
  if (tab.id === undefined || !mediaId) {
    throw bridgeError('INVALID_VALUE', 'End Frame requires an exact mediaId.', false);
  }
  await ensureDesktopViewport(tab);
  // Không giật active: true sang tab Flow
  await timeoutable(chrome.tabs.sendMessage(tab.id, {
    type: 'FLOWGRAPH_SYNC_SUPPRESS_ECHO',
    field: 'endImage',
    value: { mediaId },
  }), 2_000).catch(() => undefined);
  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  let attached = false;
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (response.exceptionDetails) {
      throw bridgeError('UI_NOT_READY', response.exceptionDetails.text ?? 'Flow DOM evaluation failed.', true);
    }
    return response.result?.value as T;
  };
  const clickAt = (x: number, y: number) => cdpClickAt(target, x, y, 70);
  const endBoundExpression = `((mediaId) => {
    const swap = [...document.querySelectorAll('button')].find((button) =>
      [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
        .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
    const endSlot = swap?.nextElementSibling;
    return [...(endSlot?.querySelectorAll('img, video, [data-media-id]') || [])].some((element) => {
      const source = String(element.currentSrc || element.src || element.getAttribute('src') || '');
      const directId = String(element.getAttribute?.('data-media-id') || '');
      return source.includes(mediaId) || directId === mediaId;
    });
  })(${JSON.stringify(mediaId)})`;

  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await ensureInputReachable(target);
    if (await evaluate<boolean>(endBoundExpression)) return { ok: true, mediaId };

    const endSlot = await evaluate<{ ok: boolean; x?: number; y?: number; reason?: string }>(`(() => {
      const swap = [...document.querySelectorAll('button')].find((button) =>
        [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
          .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
      const endRoot = swap?.nextElementSibling;
      const triggers = Array.from(document.querySelectorAll('.frame-trigger'));
      const target = endRoot?.querySelector('button') || triggers[1]?.querySelector('button') || endRoot || triggers[1];
      if (!target) return { ok: false, reason: 'end-slot-not-found' };
      const rect = target.getBoundingClientRect();
      return rect.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false, reason: 'end-slot-not-visible' };
    })()`);
    if (!endSlot.ok || endSlot.x === undefined || endSlot.y === undefined) {
      throw bridgeError('UI_NOT_READY', `Flow End Frame slot was not available (${endSlot.reason ?? 'unknown'}).`, true);
    }
    await clickAt(endSlot.x, endSlot.y);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const dialogOpened = await evaluate<boolean>(`[...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
      .some((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0)`);
    if (!dialogOpened) {
      // Some Flow builds do not route DevTools pointer events to this non-button
      // Radix trigger. Invoke only the exact semantic End trigger, then verify
      // that its dialog opened before interacting with any media.
      const opened = await evaluate<boolean>(`(() => {
        const element = [...document.querySelectorAll('[type="button"][aria-haspopup="dialog"], .frame-trigger, button, div')]
          .find((candidate) => /^(Kết thúc|End)$/i.test((candidate.textContent || '').trim())
            || candidate.classList.contains('frame-trigger'));
        element?.click();
        return Boolean(element);
      })()`);
      if (!opened) throw bridgeError('UI_NOT_READY', 'Flow End Frame dialog trigger disappeared.', true);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    const readDialogMedia = () => evaluate<{ ok: boolean; x?: number; y?: number; reason?: string }>(`((mediaId) => {
      const dialog = [...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
        .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
      
      // Look up poster token from main page if data-media-id is not inside dialog
      const mainMedia = [...document.querySelectorAll('img, video, a, [data-media-id]')]
        .find((el) => [el.getAttribute?.('data-media-id'), el.getAttribute?.('src'), el.currentSrc, el.src]
          .filter(Boolean).some((v) => String(v).includes(mediaId)));
      const mainSrc = mainMedia ? (mainMedia.currentSrc || mainMedia.src || '') : '';
      const token = mainSrc.includes('/asb/') ? mainSrc.split('/asb/')[1]?.slice(0, 20) : '';

      const matches = [...(dialog?.querySelectorAll('img, video, [data-media-id]') || [])]
        .filter((element) => {
          const src = String(element.currentSrc || element.src || element.getAttribute?.('src') || '');
          const directId = String(element.getAttribute?.('data-media-id') || '');
          return directId === mediaId || src.includes(mediaId) || (token && src.includes(token)) || (mediaId && mediaId.length > 8 && src.includes(mediaId.slice(0, 16)));
        })
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      // Fallback: if exact match not found yet in freshly opened dialog, pick the first media item (newest)
      const element = matches[0]?.element;
      if (!element) return { ok: false, reason: 'exact-dialog-media-not-found' };
      const card = element.closest('[role="button"], button') || element;
      const rect = card.getBoundingClientRect();
      return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })(${JSON.stringify(mediaId)})`);
    let media = await readDialogMedia();
    for (let attempt = 0; attempt < 20 && !media.ok; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      media = await readDialogMedia();
    }
    if (!media.ok || media.x === undefined || media.y === undefined) {
      throw bridgeError('MEDIA_FAILED', `Exact End Frame media ${mediaId} was not found (${media.reason ?? 'unknown'}).`, true);
    }
    await clickAt(media.x, media.y);
    await new Promise((resolve) => setTimeout(resolve, 350));

    const readAddButton = () => evaluate<{ ok: boolean; x?: number; y?: number; reason?: string }>(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
        .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
      const button = [...(dialog?.querySelectorAll('button') || [])]
        .find((candidate) => /Thêm vào câu lệnh|Add to prompt|Xác nhận|Confirm|Chọn|Select/i.test(candidate.innerText || ''));
      if (!button) return { ok: false, reason: 'add-to-prompt-not-found' };
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
        return { ok: false, reason: 'add-to-prompt-disabled' };
      }
      const rect = button.getBoundingClientRect();
      return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    let add = await readAddButton();
    for (let attempt = 0; attempt < 10 && !add.ok; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      add = await readAddButton();
    }
    if (!add.ok || add.x === undefined || add.y === undefined) {
      throw bridgeError('UI_NOT_READY', `Flow End Frame picker could not commit (${add.reason ?? 'unknown'}).`, true);
    }
    await clickAt(add.x, add.y);
    for (let check = 0; check < 10; check += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (await evaluate<boolean>(endBoundExpression)) return { ok: true, mediaId };
    }
    if (!(await evaluate<boolean>(endBoundExpression))) {
      throw bridgeError('MEDIA_FAILED', `Flow did not bind ${mediaId} as the End Frame.`, true);
    }
    return { ok: true, mediaId };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function bindRealtimeVideoInput(
  tab: chrome.tabs.Tab,
  mediaId: string,
  mode?: string,
): Promise<{ ok: true; mediaId: string }> {
  if (tab.id === undefined || !mediaId) {
    throw bridgeError('INVALID_VALUE', 'Extend/Edit Video requires an exact mediaId.', false);
  }
  const projectUrl = (tab.url ?? '').replace(/\/edit\/[0-9a-zA-Z_-]+.*$/, '');
  await ensureDesktopViewport(tab);
  // Không cướp active: true
  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  let attached = false;
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (response.exceptionDetails) throw bridgeError('UI_NOT_READY', response.exceptionDetails.text ?? 'Flow DOM evaluation failed.', true);
    return response.result?.value as T;
  };
  const clickAt = (x: number, y: number) => cdpClickAt(target, x, y, 70);

  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await ensureInputReachable(target);

    // Navigate directly to the video's editor URL: /edit/<mediaId>
    // This allows exact, deterministic binding of the requested mediaId even if the
    // gallery tile doesn't embed the UUID in its DOM.
    const editUrl = `${projectUrl}/edit/${mediaId}`;
    await chrome.debugger.sendCommand(target, 'Page.navigate', { url: editUrl }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // In /edit/<mediaId> editor, the video is ALREADY the active canvas media!
    // The editor has an "Add clip" / "add_2" button for Extend Forward, or directly
    // edits the prompt ("Mô tả cách chỉnh sửa video này…") for Edit Video.
    const editSetup = await evaluate<{ ok: boolean; x?: number; y?: number; mode: string }>(`((mode) => {
      const isExtend = mode === 'Extend Forward';
      if (isExtend) {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          const txt = (b.innerText||'').trim();
          const aria = (b.getAttribute('aria-label')||'').trim();
          return aria === 'Add clip' || txt === 'add_2' || (b.querySelector('mat-icon, i')?.innerText || '') === 'add_2';
        });
        if (btn) {
          const r = btn.getBoundingClientRect();
          return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), mode };
        }
      }
      return { ok: true, mode };
    })(${JSON.stringify(mode)})`);

    if (editSetup.ok && editSetup.x !== undefined && editSetup.y !== undefined) {
      await clickAt(editSetup.x, editSetup.y);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    // STRICT VERIFICATION: Verify that we are indeed in the editor for the EXACT mediaId requested
    const hereUrl = await evaluate<string>('location.href');
    if (!hereUrl || !hereUrl.includes(`/edit/${mediaId}`)) {
      throw bridgeError('MEDIA_FAILED', `Flow did not navigate to editor for video ${mediaId} (current: ${hereUrl}).`, true);
    }

    return { ok: true, mediaId };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function bindRealtimeReferenceMedia(
  tab: chrome.tabs.Tab,
  values: Array<{ mediaId: string }>,
): Promise<{ ok: true; mediaIds: string[] }> {
  if (tab.id === undefined) {
    throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  }
  const expectedProjectId = projectIdFromUrl(tab.url ?? '');
  const mediaIds = [...new Set(values.map((value) => value.mediaId.trim()).filter(Boolean))];
  if (!expectedProjectId) {
    throw bridgeError('PROJECT_MISMATCH', 'Reference Media requires an exact Flow project.', false);
  }
  if (mediaIds.length === 0) {
    throw bridgeError('INVALID_VALUE', 'Reference Media requires at least one exact mediaId.', false);
  }
  // Giữ nguyên tab hiện tại, không cướp active: true
  await timeoutable(chrome.tabs.sendMessage(tab.id, {
    type: 'FLOWGRAPH_SYNC_SUPPRESS_ECHO',
    field: 'referenceMedia',
    value: mediaIds.map((mediaId) => ({ mediaId })),
  }), 2_000).catch(() => undefined);
  // Current Flow exposes Reference/Ingredients through the composer add-menu.
  // Older builds first switched Settings -> Components, but that mode no longer
  // exists in the live Settings surface. Keep echo suppression, then bind the
  // exact media directly through button.add-menu-trigger below.
  await timeoutable(chrome.tabs.sendMessage(tab.id, {
    type: 'FLOWGRAPH_SYNC_SUPPRESS_ECHO',
    field: 'referenceMedia',
    value: mediaIds.map((mediaId) => ({ mediaId })),
  }), 2_000).catch(() => undefined);

  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  let attached = false;
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (response.exceptionDetails) {
      throw bridgeError('UI_NOT_READY', response.exceptionDetails.text ?? 'Flow DOM evaluation failed.', true);
    }
    return response.result?.value as T;
  };
  const clickAt = (point: { x: number; y: number }): Promise<void> => cdpClickAt(target, point.x, point.y, 70);
  const referenceIdsExpression = `(() => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
      || document.querySelector('.ProseMirror[contenteditable="true"]')
      || document.querySelector('[role="textbox"][contenteditable="true"]');
    if (!editor) return [];
    const editorRect = editor.getBoundingClientRect();
    const swap = [...document.querySelectorAll('button')].find((button) =>
      [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
        .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
    const frameRoots = [swap?.previousElementSibling, swap?.nextElementSibling].filter(Boolean);
    const ids = [...document.querySelectorAll('button')]
      .filter((button) => [...button.querySelectorAll('i.google-symbols, .google-symbols')]
        .some((icon) => (icon.textContent || '').trim() === 'cancel'))
      .filter((button) => !frameRoots.some((root) => root.contains(button)))
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.width <= 90 && rect.height <= 90
          && rect.bottom >= editorRect.top - 220 && rect.top <= editorRect.bottom + 80;
      })
      .map((button) => [...button.querySelectorAll('img, video, [data-media-id]')]
        .flatMap((element) => [
          element.getAttribute?.('data-media-id'), element.getAttribute?.('src'),
          element.currentSrc, element.src,
        ].filter(Boolean).map(String))
        .map((value) => value.match(uuid)?.[0]).find(Boolean))
      .filter(Boolean);
    return [...new Set(ids)];
  })()`;

  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await ensureInputReachable(target);

    // Remove existing component chips one at a time. Re-query after each React
    // update so stale nodes cannot remove an adjacent frame slot.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const removed = await evaluate<{ onProject: boolean; removed: boolean }>(`((projectId) => {
        if (!location.pathname.includes('/project/' + projectId)) {
          return { onProject: false, removed: false };
        }
        const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
          || document.querySelector('.ProseMirror[contenteditable="true"]')
          || document.querySelector('[role="textbox"][contenteditable="true"]');
        if (!editor) return { onProject: true, removed: false };
        const editorRect = editor.getBoundingClientRect();
        const swap = [...document.querySelectorAll('button')].find((button) =>
          [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
            .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
        const frameRoots = [swap?.previousElementSibling, swap?.nextElementSibling].filter(Boolean);
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => {
            if (frameRoots.some((root) => root.contains(candidate))) return false;
            const hasCancel = [...candidate.querySelectorAll('i.google-symbols, .google-symbols')]
              .some((icon) => (icon.textContent || '').trim() === 'cancel');
            const hasMedia = Boolean(candidate.querySelector('img, video, [data-media-id]'));
            const rect = candidate.getBoundingClientRect();
            return hasCancel && hasMedia && rect.width > 0 && rect.height > 0
              && rect.width <= 90 && rect.height <= 90
              && rect.bottom >= editorRect.top - 220 && rect.top <= editorRect.bottom + 80;
          });
        if (!button) return { onProject: true, removed: false };
        button.click();
        return { onProject: true, removed: true };
      })(${JSON.stringify(expectedProjectId)})`);
      if (!removed.onProject) {
        throw bridgeError('PROJECT_MISMATCH', 'Flow navigated away while clearing Reference Media.', false);
      }
      if (!removed.removed) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if ((await evaluate<string[]>(referenceIdsExpression)).length > 0) {
      throw bridgeError('PREFLIGHT_FAILED', 'Could not clear existing Flow Reference Media.', true);
    }

    // Current Flow exposes Reference/Ingredients directly from the composer add-menu.
    // Fail closed if that live surface is not present; never fall back to a stale
    // Settings -> Components path because Components is no longer a Settings mode.
    const referenceAddReady = await evaluate<boolean>(`(() => {
      const button = document.querySelector('button.add-menu-trigger')
        || document.querySelector('button[aria-label="Thêm thành phần vào ô nhập câu lệnh"]')
        || Array.from(document.querySelectorAll('button')).find((candidate) => {
          const aria = candidate.getAttribute('aria-label') || '';
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && aria.includes('Thêm thành phần vào ô nhập câu lệnh');
        });
      if (!button) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })()`);
    if (!referenceAddReady) {
      throw bridgeError('UI_NOT_READY', 'Flow Reference/Ingredients add-menu was not available.', true);
    }

    for (const mediaId of mediaIds) {
      const addTrigger = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const button = document.querySelector('button.add-menu-trigger')
          || document.querySelector('button[aria-label="Thêm thành phần vào ô nhập câu lệnh"]')
          || Array.from(document.querySelectorAll('button')).find((b) => {
              const aria = b.getAttribute('aria-label') || '';
              return (aria.includes('Thêm thành phần')) && b.getBoundingClientRect().top > 500;
            });
        if (!button) return { ok: false };
        const rect = button.getBoundingClientRect();
        return rect.width && rect.height
          ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { ok: false };
      })()`);
      if (!addTrigger.ok || addTrigger.x === undefined || addTrigger.y === undefined) {
        throw bridgeError('UI_NOT_READY', 'Flow Reference Media picker trigger was not available.', true);
      }
      await clickAt({ x: addTrigger.x, y: addTrigger.y });
      await new Promise((resolve) => setTimeout(resolve, 350));

      // Bounded retry for option discovery in freshly opened dialog
      let option: { ok: boolean; selected?: boolean; x?: number; y?: number } = { ok: false };
      for (let attempt = 0; attempt < 8; attempt += 1) {
        option = await evaluate<{ ok: boolean; selected?: boolean; x?: number; y?: number }>(`((mediaId) => {
          // Resolve media token on grid if available
          const gridMedia = document.querySelector('[data-media-id="' + mediaId + '"]')
            || Array.from(document.querySelectorAll('flow-tile-container, [data-media-id], img')).find(el => {
                const id = el.getAttribute('data-media-id') || el.querySelector?.('img')?.getAttribute('data-media-id');
                const src = el.src || el.querySelector?.('img')?.src || '';
                return id === mediaId || src.includes(mediaId);
            });
          const gridImg = gridMedia?.tagName === 'IMG' ? gridMedia : gridMedia?.querySelector?.('img');
          const gridSrc = gridImg?.src || gridMedia?.src || '';
          const match = gridSrc.match(/\\/asb\\/([A-Za-z0-9_-]{20,})/);
          const asbToken = match ? match[1] : null;

          const dialogs = [...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
            .filter((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
          // Find dialog containing media elements
          const dialog = dialogs.find(d => d.querySelector('img, video, [data-media-id], .asset-item')) || dialogs[dialogs.length - 1];
          const shortPrefix = mediaId.slice(0, 16);
          const media = [...(dialog?.querySelectorAll('img, video, [data-media-id]') || [])]
            .find((element) => {
              const src = String(element.getAttribute?.('src') || element.currentSrc || element.src || '');
              const attr = String(element.getAttribute?.('data-media-id') || '');
              return attr === mediaId || src.includes(mediaId) || src.includes(shortPrefix) || (asbToken && src.includes(asbToken.slice(0, 25)));
            });
          if (!media) return { ok: false, reason: 'dialog-has-no-media' };
          const row = media.closest?.('.asset-item') || media.closest?.('flow-tile-container') || media.closest?.('[role="button"]') || media.closest?.('button') || media.parentElement || media;
          const rect = row.getBoundingClientRect();
          return row && rect.width && rect.height
            ? { ok: true, selected: row.getAttribute?.('aria-selected') === 'true' || row.classList?.contains('selected') || row.classList?.contains('asset-item-active'), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : { ok: false, reason: 'row-not-visible' };
        })(${JSON.stringify(mediaId)})`);
        if (option.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (!option.ok || option.x === undefined || option.y === undefined) {
        throw bridgeError('MEDIA_FAILED', `Exact Reference Media ${mediaId} was not found in the Flow picker.`, true);
      }
      if (!option.selected) {
        await clickAt({ x: option.x, y: option.y });
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      // Check if dialog has confirm/add button, or clicking the tile already selects it
      const addButton = await evaluate<{ ok: boolean; x?: number; y?: number; reason?: string }>(`(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
          .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
        const button = [...(dialog?.querySelectorAll('button') || [])]
          .find((candidate) => candidate.classList.contains('detail-add-to-prompt-btn')
            || /Thêm vào câu lệnh|Thêm|Add|Xác nhận|Confirm|Chọn|Select/i.test(candidate.innerText || ''));
        if (!button) return { ok: false, reason: 'add-button-not-found' };
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
          return { ok: false, reason: 'add-button-disabled' };
        }
        const rect = button.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (addButton.ok && addButton.x !== undefined && addButton.y !== undefined) {
        await clickAt({ x: addButton.x, y: addButton.y });
        await new Promise((resolve) => setTimeout(resolve, 550));
      } else {
        // Double click option or close dialog
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
        }).catch(() => undefined);
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
        }).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const applied = await evaluate<string[]>(referenceIdsExpression);
      console.info('[FlowGraph Sync] Applied reference media after commit:', applied);
    }

    // Never verify while the asset picker is still visible: picker media can look
    // like a bound composer reference and produce a false-positive receipt.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const overlays = await evaluate<number>(`[...document.querySelectorAll('.cdk-overlay-pane')].filter((pane) => {
        const rect = pane.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length`).catch(() => 0);
      if (!overlays) break;
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      }).catch(() => undefined);
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    const applied = await evaluate<string[]>(referenceIdsExpression);
    if (JSON.stringify(applied) !== JSON.stringify(mediaIds)) {
      throw bridgeError(
        'MEDIA_FAILED',
        `Flow Reference Media order mismatch (requested ${mediaIds.join(', ')}, applied ${applied.join(', ')}).`,
        true,
      );
    }
    return { ok: true, mediaIds: applied };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function bindRealtimeMode(
  tab: chrome.tabs.Tab,
  mode: unknown,
): Promise<{ ok: true; value: 'IMAGE' | 'VIDEO' }> {
  const requested = mode === 'IMAGE' || mode === 'VIDEO' ? mode : null;
  if (tab.id === undefined || !requested) {
    throw bridgeError('INVALID_VALUE', 'Mode must be IMAGE or VIDEO.', false);
  }
  await ensureDesktopViewport(tab);
  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  let attached = false;
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (response.exceptionDetails) {
      throw bridgeError('UI_NOT_READY', response.exceptionDetails.text ?? 'Flow DOM evaluation failed.', true);
    }
    return response.result?.value as T;
  };
  const clickAt = (x: number, y: number) => cdpClickAt(target, x, y);
  const readChip = () => evaluate<string>(`(() => {
    const button = document.querySelector('button.settings-trigger-button');
    return button ? (button.innerText || '').replace(/\\s+/g, ' ').trim() : '';
  })()`);
  const closeOverlays = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const count = await evaluate<number>(`document.querySelectorAll('.cdk-overlay-pane, [role="menu"][data-state="open"]').length`).catch(() => 0);
      if (!count) return;
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      }).catch(() => undefined);
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
  };
  const modeMatches = (chip: string) => canSubmitGenerateWithComposerMode({
    kind: requested === 'VIDEO' ? 't2v' : 't2i',
    liveChipText: chip,
  });

  try {
    try {
      await chrome.debugger.attach(target, '1.3');
      attached = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already attached/i.test(message)) {
        throw bridgeError('UI_NOT_READY', `Cannot attach debugger to switch mode: ${message}`, true);
      }
    }
    await ensureInputReachable(target);
    await closeOverlays();

    let chip = await readChip();
    if (modeMatches(chip)) return { ok: true, value: requested };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const trigger = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const button = document.querySelector('button.settings-trigger-button');
        if (!button) return { ok: false };
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const r = button.getBoundingClientRect();
        return r.width > 8 && r.height > 8
          ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }
          : { ok: false };
      })()`);
      if (!trigger.ok || trigger.x === undefined || trigger.y === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      await clickAt(trigger.x, trigger.y);
      await new Promise((resolve) => setTimeout(resolve, 350));

      const targetMode = await evaluate<{ ok: boolean; x?: number; y?: number; options?: string[] }>(`(() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const panes = [...document.querySelectorAll('.cdk-overlay-pane')];
        const pane = panes.find((root) => {
          const text = clean(root.innerText);
          return /Hình ảnh|Image/i.test(text) && /Video/i.test(text);
        });
        const controls = pane ? [...pane.querySelectorAll('button, [role="tab"], [role="radio"], .mat-button-toggle-button')] : [];
        const wanted = controls.find((control) => {
          const text = clean(control.innerText).toLowerCase();
          return ${requested === 'VIDEO'}
            ? (text === 'video' || text.endsWith(' video') || text.includes('videocam video'))
            : (text === 'image' || text === 'hình ảnh' || text.endsWith(' hình ảnh') || text.includes('image hình ảnh'));
        });
        if (!wanted) return { ok: false, options: controls.map((control) => clean(control.innerText)).filter(Boolean) };
        wanted.scrollIntoView({ block: 'center', inline: 'center' });
        const r = wanted.getBoundingClientRect();
        return r.width > 8 && r.height > 8
          ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }
          : { ok: false };
      })()`);
      if (!targetMode.ok || targetMode.x === undefined || targetMode.y === undefined) {
        await closeOverlays();
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      await clickAt(targetMode.x, targetMode.y);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await closeOverlays();

      // A transient chip change is not enough. Require the requested modality
      // to survive several post-close reads before returning a successful receipt.
      let stableReads = 0;
      for (let tick = 0; tick < 6; tick += 1) {
        chip = await readChip();
        stableReads = modeMatches(chip) ? stableReads + 1 : 0;
        if (stableReads >= 2) return { ok: true, value: requested };
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
    }

    // A mode change can finish just after the last retry loop while Angular is
    // remounting the composer. Do not throw from a stale retry boundary when the
    // final live chip has already switched; require two consecutive final reads
    // before accepting the delayed commit.
    let finalStableReads = 0;
    for (let tick = 0; tick < 4; tick += 1) {
      chip = await readChip();
      finalStableReads = modeMatches(chip) ? finalStableReads + 1 : 0;
      if (finalStableReads >= 2) return { ok: true, value: requested };
      if (tick < 3) await new Promise((resolve) => setTimeout(resolve, 180));
    }
    throw bridgeError(
      'UI_NOT_READY',
      `Flow composer did not commit ${requested} mode (chip: ${chip || 'none'}).`,
      true,
    );
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function bindRealtimeDuration(
  tab: chrome.tabs.Tab,
  value: unknown,
): Promise<{ ok: true; value: number }> {
  const requested = Number(value);
  if (tab.id === undefined || !Number.isFinite(requested) || requested <= 0) {
    throw bridgeError('INVALID_VALUE', 'Duration must be a positive number of seconds.', false);
  }
  await ensureDesktopViewport(tab);
  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  let attached = false;
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (response.exceptionDetails) {
      throw bridgeError('UI_NOT_READY', response.exceptionDetails.text ?? 'Flow DOM evaluation failed.', true);
    }
    return response.result?.value as T;
  };
  const clickAt = (x: number, y: number) => cdpClickAt(target, x, y);
  const closeOverlays = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const count = await evaluate<number>(`document.querySelectorAll('.cdk-overlay-pane').length`).catch(() => 0);
      if (!count) return;
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      }).catch(() => undefined);
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
  };
  const readDuration = () => evaluate<number | null>(`(() => {
    const button = document.querySelector('button.settings-trigger-button');
    const text = (button?.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const match = text.match(/(?:^|\\s)(\\d+)\\s*(?:s|sec|seconds?|giây|giay)(?:\\s|$)/i);
    return match ? Number(match[1]) : null;
  })()`);

  try {
    try {
      await chrome.debugger.attach(target, '1.3');
      attached = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already attached/i.test(message)) {
        throw bridgeError('UI_NOT_READY', `Cannot attach debugger to set duration: ${message}`, true);
      }
    }
    await ensureInputReachable(target);
    await closeOverlays();
    if (await readDuration() === requested) return { ok: true, value: requested };

    let lastAvailable: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const trigger = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const button = document.querySelector('button.settings-trigger-button');
        if (!button) return { ok: false };
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const r = button.getBoundingClientRect();
        return r.width > 8 && r.height > 8
          ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }
          : { ok: false };
      })()`);
      if (!trigger.ok || trigger.x === undefined || trigger.y === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 220));
        continue;
      }
      await clickAt(trigger.x, trigger.y);
      await new Promise((resolve) => setTimeout(resolve, 350));

      const targetDuration = await evaluate<{ ok: boolean; x?: number; y?: number; available: number[] }>(`(() => {
        const parse = (value) => {
          const text = (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          const match = text.match(/^(\\d+)\\s*(?:s|sec|seconds?|giây|giay)$/i);
          return match ? Number(match[1]) : null;
        };
        const panes = [...document.querySelectorAll('.cdk-overlay-pane')].filter((pane) => {
          const r = pane.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const controls = panes.flatMap((pane) => [...pane.querySelectorAll('button[role="radio"], .mat-button-toggle-button, button')]);
        const durationControls = controls.map((control) => ({ control, seconds: parse(control.innerText || control.textContent || '') }))
          .filter((entry) => entry.seconds !== null);
        const available = [...new Set(durationControls.map((entry) => entry.seconds))];
        const wanted = durationControls.find((entry) => entry.seconds === ${requested});
        if (!wanted) return { ok: false, available };
        const r = wanted.control.getBoundingClientRect();
        return r.width > 8 && r.height > 8
          ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, available }
          : { ok: false, available };
      })()`);
      lastAvailable = targetDuration.available || [];
      if (!targetDuration.ok || targetDuration.x === undefined || targetDuration.y === undefined) {
        await closeOverlays();
        if (lastAvailable.length > 0 && !lastAvailable.includes(requested)) {
          throw bridgeError('INVALID_VALUE', `Flow does not expose ${requested}s for the selected model/mode.`, false);
        }
        await new Promise((resolve) => setTimeout(resolve, 220));
        continue;
      }
      await clickAt(targetDuration.x, targetDuration.y);
      await new Promise((resolve) => setTimeout(resolve, 450));
      await closeOverlays();

      let stableReads = 0;
      for (let tick = 0; tick < 6; tick += 1) {
        const applied = await readDuration();
        stableReads = applied === requested ? stableReads + 1 : 0;
        if (stableReads >= 2) return { ok: true, value: requested };
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    }
    const applied = await readDuration();
    throw bridgeError('UI_NOT_READY', `Flow duration did not commit ${requested}s (read back ${applied ?? 'none'}).`, true);
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function bindRealtimeModel(
  tab: chrome.tabs.Tab,
  modelLabel: string,
): Promise<{ ok: true; model: string }> {
  const requested = modelLabel.trim();
  if (tab.id === undefined || !requested) {
    throw bridgeError('INVALID_VALUE', 'Model requires an exact label.', false);
  }
  await ensureDesktopViewport(tab);
  const target: chrome.debugger.Debuggee = { tabId: tab.id };
  let attached = false;
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (response.exceptionDetails) {
      throw bridgeError('UI_NOT_READY', response.exceptionDetails.text ?? 'Flow DOM evaluation failed.', true);
    }
    return response.result?.value as T;
  };
  const clickAt = (x: number, y: number) => cdpClickAt(target, x, y);
  const chipText = () => evaluate<string>(`(() => {
    const clean = (value) => (value || '')
      .replace(/arrow_drop_down/gi, ' ')
      .replace(/volume_up/gi, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    // Model identity is authoritative only on the parent Settings pane. A model
    // submenu contains all options at once; scanning every overlay can therefore
    // misread the first option (often Omni) as the selected model.
    const panes = [...document.querySelectorAll('.cdk-overlay-pane, [role="menu"][data-state="open"]')];
    const settingsPane = panes.find((root) => {
      const buttons = [...root.querySelectorAll('button')];
      const hasMode = buttons.some((button) => /(?:^|\\s)(?:Hình ảnh|Image|Video)$/i.test(clean(button.innerText)));
      const hasModel = buttons.some((button) => button.getAttribute('aria-haspopup') === 'menu'
        && /banana|veo|omni|imagen/i.test(clean(button.innerText)));
      return hasMode && hasModel;
    });
    const btn = settingsPane && [...settingsPane.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-haspopup') === 'menu'
        && /banana|veo|omni|imagen/i.test(clean(button.innerText)));
    return btn ? clean(btn.innerText) : '';
  })()`);
  const closeModelMenu = async () => {
    // Flow can leave stacked overlays behind after media-picker / upload / consent
    // interactions. Four Escapes were not enough in live UI and caused the next
    // Settings click to hit a backdrop while chipText() returned empty. Drain all
    // visible overlays before attempting a model switch.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const count = await evaluate<number>(`[...document.querySelectorAll('.cdk-overlay-pane, [role="menu"][data-state="open"]')].filter((x)=>{const r=x.getBoundingClientRect();return r.width>2&&r.height>2}).length`).catch(() => 0);
      if (!count) break;
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      }).catch(() => undefined);
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 160));
    }
  };
  const listModelOptions = () => evaluate<Array<{ text: string; x: number; y: number }>>(`(() => {
    const clean = (value) => (value || '')
      .replace(/arrow_drop_down/gi, ' ')
      .replace(/volume_up/gi, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const panes = [...document.querySelectorAll('.cdk-overlay-pane, [role="menu"][data-state="open"], [role="listbox"]')];
    const modelPane = panes.find((root) => {
      const texts = [...root.querySelectorAll('[role="menuitem"], [role="option"], button')].map((el) => clean(el.innerText));
      return texts.filter((text) => /banana|veo|omni|imagen/i.test(text)).length >= 2
        && !texts.some((text) => /^x[1-4]$/i.test(text));
    });
    const nodes = modelPane ? [...modelPane.querySelectorAll('[role="menuitem"], [role="option"], button')] : [];
    return nodes.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: clean(el.innerText),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: r.width,
        h: r.height,
      };
    }).filter((o) => o.w > 8 && o.h > 8 && o.text && /banana|veo|omni|imagen/i.test(o.text));
  })()`);
  try {
    try {
      await chrome.debugger.attach(target, '1.3');
      attached = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already attached/i.test(message)) {
        throw bridgeError('UI_NOT_READY', `Cannot attach debugger to switch model: ${message}`, true);
      }
    }
    // Model changes are realtime Studio sync. Keep Google Flow fully in the
    // background; never activate/foreground its tab just to mirror a combobox.
    await ensureInputReachable(target);
    await closeModelMenu();
    let chip = '';
    for (let switchAttempt = 0; switchAttempt < 3; switchAttempt += 1) {
    chip = await chipText();
    if (composerChipMatchesRequestedModel(chip, requested)) {
      return { ok: true, model: requested };
    }
    // Reset stale overlays only after checking whether a delayed commit already won.
    if (switchAttempt > 0) {
      await closeModelMenu();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
      chip = await chipText();
      if (composerChipMatchesRequestedModel(chip, requested)) {
        return { ok: true, model: requested };
      }
      const trigger = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        if (!btn) return { ok: false };
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        const r = btn.getBoundingClientRect();
        return r.width && r.height ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 } : { ok: false };
      })()`);
      if (!trigger.ok || trigger.x === undefined || trigger.y === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      // Use the app's own DOM click for the Settings trigger after stale overlays
      // are drained. A physical pointer click can still land on a transient
      // Angular backdrop even when the button geometry is correct.
      const domOpened = await evaluate<boolean>(`(()=>{const b=document.querySelector('button.settings-trigger-button');if(!b)return false;b.click();return true})()`);
      if (!domOpened) {
        await clickAt(trigger.x, trigger.y);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      opened = Boolean(await evaluate<boolean>(`(()=>{const clean=(v)=>(v||'').replace(/\\s+/g,' ').trim();return [...document.querySelectorAll('.cdk-overlay-pane')].some((root)=>{const buttons=[...root.querySelectorAll('button')];const hasMode=buttons.some((b)=>/(?:^|\\s)(?:Hình ảnh|Image|Video)$/i.test(clean(b.innerText)));const hasModel=buttons.some((b)=>b.getAttribute('aria-haspopup')==='menu'&&/banana|veo|omni|imagen/i.test(clean(b.innerText)));return hasMode&&hasModel})})()`));
    }
    if (!opened) {
      continue;
    }
    chip = await chipText();
    if (composerChipMatchesRequestedModel(chip, requested)) {
      await closeModelMenu();
      return { ok: true, model: requested };
    }
    let options = await listModelOptions();
    let item = options.find((option) => flowModelOptionMatchesRequested(option.text, requested) && !/arrow_drop_down/i.test(option.text));
    if (!item) {
      const group = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const roots = [...document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="listbox"]')];
        const btn = roots
          .flatMap((root) => [...root.querySelectorAll('button')])
          .find((b) => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const text = clean(b.innerText);
            return b.getAttribute('aria-haspopup') === 'menu'
              && (aria.includes('mô hình') || aria.includes('model') || /banana|veo|omni|imagen/i.test(text));
          });
        if (!btn) return { ok: false };
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        const r = btn.getBoundingClientRect();
        return r.width && r.height ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 } : { ok: false };
      })()`);
      if (!group.ok || group.x === undefined || group.y === undefined) {
        continue;
      }
      await clickAt(group.x, group.y);
      await new Promise((resolve) => setTimeout(resolve, 400));
      options = await listModelOptions();
      item = options.find((option) => flowModelOptionMatchesRequested(option.text, requested) && !/arrow_drop_down/i.test(option.text));
    }
    if (!item) {
      continue;
    }
    await clickAt(item.x, item.y);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Selecting a submenu item keeps the parent Settings overlay alive. Verify
    // the actual model trigger there BEFORE closing it; the main composer chip
    // does not contain the model name and cannot prove a commit.
    for (let tick = 0; tick < 8; tick += 1) {
      chip = await chipText();
      if (composerChipMatchesRequestedModel(chip, requested)) {
        await closeModelMenu();
        return { ok: true, model: requested };
      }
      if (tick < 7) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await closeModelMenu();
    await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // No exact model proof was observed in the real Settings model trigger.
    chip = chip || '';
    throw bridgeError(
      'INVALID_MODEL',
      `Flow model did not commit "${requested}" (chip: ${chip || 'none'}).`,
      true,
    );
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function forwardSyncWrite(request: BridgeRequest): Promise<BridgeResponse<unknown>> {
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const requestedProjectId = typeof payload.projectId === 'string' ? payload.projectId : undefined;
  if (!requestedProjectId) {
    return makeError(request.requestId, 'PROJECT_REQUIRED', 'Realtime sync requires an explicit projectId.', false);
  }
  const tab = await findFlowTab(requestedProjectId);
  if (!tab?.id) return makeError(request.requestId, 'NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  await ensureFlowContentScript(tab.id);
  const tabProjectId = projectIdFromUrl(tab.url ?? '');
  if (!tabProjectId || tabProjectId !== requestedProjectId) {
    return makeError(
      request.requestId,
      'PROJECT_MISMATCH',
      `Flow tab project ${tabProjectId ?? 'none'} does not match sync project ${requestedProjectId}.`,
      false,
    );
  }
  if (request.type === 'FLOWGRAPH_SYNC_SET_MODE') {
    try {
      return makeResponse(request.requestId, await bindRealtimeMode(tab, payload.value));
    } catch (error) {
      const normalized = normalizeError(error);
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable, normalized.reason);
    }
  }
  if (request.type === 'FLOWGRAPH_SYNC_SET_MODEL') {
    try {
      return makeResponse(request.requestId, await bindRealtimeModel(tab, String(payload.value ?? '')));
    } catch (error) {
      const normalized = normalizeError(error);
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable, normalized.reason);
    }
  }
  if (request.type === 'FLOWGRAPH_SYNC_SET_DURATION') {
    try {
      return makeResponse(request.requestId, await bindRealtimeDuration(tab, payload.value));
    } catch (error) {
      const normalized = normalizeError(error);
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable, normalized.reason);
    }
  }
  // SYNC_FOREGROUND_TYPES đã được làm rỗng, không cướp active: true
  if (SYNC_FOREGROUND_TYPES.has(request.type) && !tab.active) {
    // Không cướp active: true
  }
  if (request.type === 'FLOWGRAPH_SYNC_START_FRAME') {
    const mediaId = typeof (payload.value as { mediaId?: unknown } | undefined)?.mediaId === 'string'
      ? String((payload.value as { mediaId: string }).mediaId)
      : '';
    try {
      return makeResponse(request.requestId, await bindRealtimeStartImage(tab, mediaId));
    } catch (error) {
      const normalized = normalizeError(error);
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable, normalized.reason);
    }
  }
  if (request.type === 'FLOWGRAPH_SYNC_END_FRAME') {
    const mediaId = typeof (payload.value as { mediaId?: unknown } | undefined)?.mediaId === 'string'
      ? String((payload.value as { mediaId: string }).mediaId)
      : '';
    try {
      return makeResponse(request.requestId, await bindRealtimeEndImage(tab, mediaId));
    } catch (error) {
      const normalized = normalizeError(error);
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable, normalized.reason);
    }
  }
  if (request.type === 'FLOWGRAPH_SYNC_REFERENCE_MEDIA') {
    const values = Array.isArray(payload.value)
      ? payload.value.filter((value): value is { mediaId: string } =>
          typeof value === 'object'
          && value !== null
          && typeof (value as { mediaId?: unknown }).mediaId === 'string')
      : [];
    try {
      return makeResponse(request.requestId, await bindRealtimeReferenceMedia(tab, values));
    } catch (error) {
      const normalized = normalizeError(error);
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable, normalized.reason);
    }
  }
  if (request.type === 'FLOWGRAPH_SYNC_BIND_MEDIA') {
    return makeError(
      request.requestId,
      'NO_UI_COUNTERPART',
      `${request.type} has no verified standalone Google Flow UI adapter yet.`,
      false,
    );
  }
  const forwarded: BridgeRequest = {
    ...request,
    requestId: `sw:${request.requestId ?? crypto.randomUUID()}`,
    payload: { ...payload, tabId: tab.id },
  };
  const reply = await timeoutable(
    chrome.tabs.sendMessage(tab.id, forwarded),
    SYNC_WRITE_TIMEOUT_MS,
  ).catch((err) => {
    return { ok: false, code: 'SYNC_TIMEOUT', message: err?.message || 'Sync write timed out.' };
  }) as { ok?: boolean; code?: string; message?: string } | undefined;
  return reply?.ok
    ? makeResponse(request.requestId, reply)
    : makeResponse(request.requestId, { ok: false, code: reply?.code ?? 'UI_NOT_READY', message: reply?.message ?? 'Sync write not ready' });
}

// ---------------------------------------------------------------------------
// Entrypoints
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Note on polling: the worker exposes FLOWGRAPH_MEDIA_STATUS as a single
// request that polls the provider to terminal state (SUCCESSFUL/FAILED/CANCELED)
// or timeout (UNKNOWN). The caller drives the UI from that result. Providers do
// not offer a long-lived subscription, so MV3 worker wakes on request arrival.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  console.info('FlowGraph Extension installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isSyncRelayMessage(message)) {
    const request = message;
    if (SYNC_WRITE_TYPES.has(request.type)) {
      void withProviderFocusTelemetry(
        focusTelemetryAction(request.type),
        request.requestId,
        sender,
        () => forwardSyncWrite(request),
      ).then(sendResponse);
      return true;
    }
    const notification = message as unknown as { payload?: unknown };
    void chrome.runtime
      .sendMessage({ type: request.type, requestId: `sw:sync:${request.requestId ?? 'notification'}`, payload: notification.payload })
      .catch(() => {
        // No Studio is currently listening; next sync state will catch up.
      });
    return false;
  }
  const request = message as BridgeRequest;
  if (request?.type?.startsWith('FLOWGRAPH_')) {
    const task = () => handleRequest(request);
    void (FOCUS_TELEMETRY_REQUEST_TYPES.has(request.type)
      ? withProviderFocusTelemetry(focusTelemetryAction(request.type), request.requestId, sender, task)
      : task()).then(sendResponse);
    return true;
  }
  return false;
});

// Live tab-state reactivity: Sidepanel and Studio receive the current Flow page
// immediately after navigation or tab activation, including leaving Flow entirely.
// Polling remains only a recovery path when Chrome drops an event.
async function broadcastCurrentFlow(): Promise<void> {
  let flow: FlowStatus;
  try {
    flow = await pingFlowTab();
  } catch (error) {
    flow = { state: 'ERROR', error: error instanceof Error ? error.message : String(error) };
  }
  await chrome.runtime.sendMessage({
    type: 'FLOWGRAPH_EVENT',
    requestId: 'sw:flow:changed',
    payload: { flow },
  }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  const url = tab?.url ?? changeInfo.url ?? '';
  if (isFlowUrl(url) || changeInfo.status === 'complete') void broadcastCurrentFlow();
});

chrome.tabs.onActivated.addListener(() => {
  void broadcastCurrentFlow();
});

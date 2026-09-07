// Manifest V3 background service worker — FlowGraph provider bridge.
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
  EDITOR_PLACEHOLDER_PREFIXES,
} from './videoTileDetection';
import {
  MEDIA_WAIT_IMAGE_MS,
  MEDIA_WAIT_VIDEO_MS,
  VIDEO_TILE_MAX_CANDIDATES,
  VIDEO_TILE_RECOVERY_STEP_MS,
  DOWNLOAD_RESOLVE_BUDGET_MS,
  DOWNLOAD_TRANSFER_BUDGET_MS,
} from '../shared/timeouts';

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
const SYNC_WRITE_TIMEOUT_MS = 12_000;
// The transfer budget only. The signed-URL resolve loop above has its own
// bounds, and the adapter's DOWNLOAD_BRIDGE_CEILING_MS sits above both, so the
// bridge is never the thing that ends a healthy download.
const DOWNLOAD_TIMEOUT_MS = DOWNLOAD_TRANSFER_BUDGET_MS;

const FLOW_SITEKEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

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
  // Preferred path: ask the content script in a live Flow tab so the token is
  // minted with the page's own cookies. After the labs.google/fx -> flow.google.com
  // migration the content script may not be injected yet (or the tab may be on the
  // new domain), so fall back to fetching the session endpoint directly from the
  // service worker, which holds the https://labs.google/* host permission and the
  // same browser cookies. Both paths only ever relay the token in-memory.
  let reply: { ok?: boolean; token?: string; user?: { name?: string; email?: string }; expiresAt?: string; message?: string } | null = null;
  if (tab && tab.id !== undefined) {
    try {
      reply = await timeoutable(chrome.tabs.sendMessage(tab.id, { type: 'GET_FX_SESSION' }), REQUEST_TIMEOUT_MS);
    } catch {
      reply = null;
    }
  }
  if (!reply?.ok || !reply.token) {
    reply = await fetchSessionDirect();
  }
  if (!reply?.ok || !reply.token) {
    throw bridgeError('AUTH_EXPIRED', reply?.message ?? 'Flow session could not be refreshed.', true);
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

async function findFlowTab(): Promise<chrome.tabs.Tab | null> {
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
    if (activeProjectId && projectId === activeProjectId) return 1_000;
    if (tab.active) return 500;
    if (projectId) return 250;
    return 0;
  };
  return candidates.sort((a, b) =>
    score(b) - score(a) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  )[0] ?? null;
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

function providerError(status: number, body: unknown): Error & { code: string; retryable: boolean } {
  const code = String((body as AiSandboxResponse | null)?.error?.code ?? '');
  const message = String((body as AiSandboxResponse | null)?.error?.message ?? `${status}`);
  const combined = `${code} ${message}`;
  if (combined.includes('reCAPTCHA') || combined.includes('UNUSUAL_ACTIVITY')) {
    return bridgeError('CAPTCHA_REQUIRED', message || 'reCAPTCHA evaluation failed', true);
  }
  if (status === 401) return bridgeError('AUTH_EXPIRED', message || 'Unauthorized', true);
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
  const auth = await ensureSession();
  void auth;
  const response = await timeoutable(fetch(`${FX_API_BASE}/${path}`, { method: 'GET', credentials: 'include' }), REQUEST_TIMEOUT_MS);
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok && !json) throw providerError(response.status, json);
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

async function recaptchaToken(projectId: string): Promise<string> {
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
      args: [FLOW_SITEKEY, 'FLOW_GENERATE'],
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
async function generateApi(payload: GeneratePayload): Promise<NormalizedMediaRef> {
  const token = await recaptchaToken(payload.projectId);
  const withToken = { ...payload, recaptchaToken: token } as GeneratePayload & { recaptchaToken: string };
  const body = buildRequestPayload(withToken);
  const json = await aisandboxFetch(endpointFor(payload), body) as Partial<AiSandboxResponse>;

  const media = json.media?.[0];
  if (!media?.name) throw bridgeError('MEDIA_FAILED', 'Provider returned no media id', false);
  const imageFife = media.image?.generatedImage?.fifeUrl;
  const previewUrl = imageFife
    ? (await resolveMediaUrl(media.name, 'IMAGE').catch(() => imageFife))
    : undefined;
  const isImageOutput = payload.kind === 't2i' || payload.kind === 'imageUpscale';
  return {
    mediaId: media.name,
    type: isImageOutput ? 'IMAGE' : 'VIDEO',
    projectId: media.projectId ?? payload.projectId,
    workflowId: media.workflowId ?? json.workflows?.[0]?.name,
    previewUrl,
  };
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
  // Images: bring the tab forward (best-effort) and read the same-origin /asb/
  // proxy URL that the [data-media-id] element already exposes.
  try {
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } catch {
    // Best-effort focus; resolution may still succeed.
  }
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

// Chrome stops delivering `Input.dispatchMouseEvent` / `dispatchKeyEvent` to a
// renderer whose document is hidden, which happens whenever the Chrome window
// is minimized or fully occluded — `Page.bringToFront` alone does not fix it
// because it cannot raise an OS-level window that another app covers. Verified
// live on 2026-09-02: with `document.visibilityState === 'hidden'` the Generate
// click was silently dropped (prompt stayed in the composer, no new media),
// and the identical click landed as soon as focus emulation was enabled.
// `Emulation.setFocusEmulationEnabled` makes the renderer report itself as
// visible/focused so the real CDP input events are processed. It only affects
// what the page is *told* about focus; it does not forge user activation,
// bypass any challenge, or touch auth state.
async function ensureInputReachable(
  target: chrome.debugger.Debuggee,
): Promise<void> {
  await chrome.debugger
    .sendCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: true })
    .catch(() => undefined);
  await chrome.debugger.sendCommand(target, 'Page.bringToFront').catch(() => undefined);
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
  // Set once the gallery URL is known; used by the finally block to hand the
  // tab back to the project gallery after the clip-editor detour.
  let projectUrl = '';
  // Google Flow only lays out the editor (and therefore the tile hotbar) while
  // its tab is the visible one; a backgrounded tab reports a 0x0 viewport and
  // every coordinate click lands on nothing. Live run 30c818fa burned the whole
  // bridge budget this way. Make the Flow tab frontmost before attaching.
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // Best-effort: focus emulation below still makes input reachable.
  }
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
    const clickAt = async (x: number, y: number): Promise<void> => {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
      });
      await new Promise((r) => setTimeout(r, 80));
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
      });
    };
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
    const downloadBtnXY = () =>
      evalOnPage<{ x: number; y: number } | null>(
        `(()=>{const b=[...document.querySelectorAll('flow-video-tile button')].find((x)=>{const a=(x.getAttribute('aria-label')||'').toLowerCase();const i=x.querySelector('mat-icon,i');return /download|tải/.test(a)||(i&&i.textContent.trim()==='download')});if(!b)return null;const r=b.getBoundingClientRect();if(r.width<2)return null;return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`,
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
        if ((current.url || '').includes('/edit/')) {
          await chrome.tabs.update(tabId, { url: projectUrl });
        }
      } catch {
        // best-effort: never fail the download because of the cleanup
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

async function handleCredits(): Promise<CreditsData> {
  try {
    const auth = await ensureSession();
    const json = await timeoutable(fetch(`${AISANDBOX_BASE}/credits`, { headers: bearerHeaders() }), REQUEST_TIMEOUT_MS);
    const data = (await json.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      credits: typeof data.remainingCredits === 'number' ? data.remainingCredits : undefined,
      userPaygateTier: typeof data.userPaygateTier === 'string' ? data.userPaygateTier : undefined,
      serviceTier: typeof data.serviceTier === 'string' ? data.serviceTier : undefined,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return { error: normalized.message };
  }
}

function unwrapTrpc(json: unknown): unknown {
  const root = json as { result?: { data?: { json?: { result?: unknown; status?: number; statusText?: string } } } };
  return root?.result?.data?.json?.result;
}

  async function handleProjectList(): Promise<ProjectListData> {
    const inputParam = encodeURIComponent(JSON.stringify({ json: { pageSize: 20, toolName: 'PINHOLE' } }));
    const json = await fxApiGet(`trpc/project.searchUserProjects?input=${inputParam}`);
    const result = unwrapTrpc(json) as { projects?: Array<{ projectId: string; projectInfo?: { projectTitle?: string } | string; creationTime?: string }> } | null;
    const raw = result?.projects ?? [];
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
): Promise<{ limitations: string[] }> {
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
    settingWrites.push({ field: 'durationSeconds', type: 'FLOWGRAPH_SYNC_SET_DURATION', value: payload.durationSeconds, optional: true });
  }
  if (payload.targetResolution) {
    settingWrites.push({ field: 'targetResolution', type: 'FLOWGRAPH_SYNC_SET_RESOLUTION', value: payload.targetResolution, optional: true });
  }
  const promptWrite: PreflightWrite | undefined = payload.prompt === undefined
    ? undefined
    : { field: 'prompt', type: 'FLOWGRAPH_SYNC_SET_PROMPT', value: payload.prompt };

  const limitations: string[] = [];
  const applyWrites = async (writes: PreflightWrite[]): Promise<void> => {
    for (const write of writes) {
      const syncId = `preflight-${write.field}-${crypto.randomUUID()}`;
      const startedAt = Date.now();
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
      ) as { ok?: boolean; code?: string; message?: string } | undefined;
      if (reply?.ok) {
        console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
          syncId,
          projectId: payload.projectId,
        });
        continue;
      }
      if (write.optional && reply?.code === 'NO_UI_COUNTERPART') {
        limitations.push(write.field);
        console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT NO_UI_COUNTERPART ${Date.now() - startedAt}ms`, {
          syncId,
          projectId: payload.projectId,
        });
        continue;
      }
      throw bridgeError(
        reply?.code ?? 'PREFLIGHT_FAILED',
        reply?.message ?? `Google Flow did not verify ${write.field} before Generate.`,
        false,
      );
    }
  };

  // Mode must exist before media controls can be inspected. Media operations
  // can remount/clear the Slate composer, so apply all scalar settings and the
  // prompt only after frame state is deterministic.
  await applyWrites([modeWrite]);
  if (payload.kind === 't2v') {
    await clearRealtimeFrameBindings(tab, ['startImage', 'endImage']);
  } else if (payload.kind === 'i2v') {
    await clearRealtimeFrameBindings(tab, ['endImage']);
  }
  if (payload.startImage?.mediaId) {
    const startedAt = Date.now();
    await bindRealtimeStartImage(tab, payload.startImage.mediaId);
    console.info(`[FlowGraph Sync] startImage PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
      projectId: payload.projectId,
    });
  }
  if (payload.endImage?.mediaId) {
    const startedAt = Date.now();
    await bindRealtimeEndImage(tab, payload.endImage.mediaId);
    console.info(`[FlowGraph Sync] endImage PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
      projectId: payload.projectId,
    });
  }
  if (payload.imageRefs && payload.imageRefs.length > 0) {
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
  return { limitations };
}

async function handleGenerate(payload: GeneratePayload): Promise<NormalizedMediaRef> {
  const tab = await findFlowTab();
  if (!tab || tab.id === undefined) throw bridgeError('NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const tabId = tab.id;

  // Enforce project isolation against the active Google Flow project
  const expectedProjectId = projectIdFromUrl(tab.url ?? '');
  if (!expectedProjectId || expectedProjectId !== payload.projectId) {
    throw bridgeError(
      'PROJECT_MISMATCH',
      `Active Google Flow tab project (${expectedProjectId || 'none'}) does not match request projectId (${payload.projectId}).`,
      false,
    );
  }

  const isUpscaleKind = payload.kind === 'upscale' || payload.kind === 'imageUpscale' || payload.kind === 'videoUpscale';
  if (isUpscaleKind) {
    // Dedicated direct provider path for Image and Video Upscaling.
    // Upscaling executes via direct aisandbox endpoints with verified project-scoped media binding.
    return generateApi(payload);
  }
  const prompt = (payload.prompt ?? '').trim();
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
  const galleryUrl = (tab.url ?? '').replace(/\/edit\/[0-9a-zA-Z_-]+.*$/, '');

  const target: chrome.debugger.Debuggee = { tabId };
  let attached = false;
  // Populated when the CDP attach fails so the content-script fallback can say so
  // in its error message instead of hiding a silent path change (see Path 2 below).
  let attachFailure = '';
  // Google Flow only renders its editor (and therefore its real Generate button
  // and media tiles) while the tab is the active/visible tab. If the tab is
  // backgrounded its viewport reports 0x0 (the editor sits off-canvas at
  // y≈-2000), so CDP coordinate clicks and readMediaIds() polling both fail.
  // Best-effort focus the tab before the debugger path regardless of which
  // branch later runs.
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // Best-effort; the content-script fallback below may still work.
  }

  // Fail closed before the real Generate click. The content adapter verifies
  // each supported counterpart after applying it; fixed/absent optional UI
  // controls are reported as NO_UI_COUNTERPART and do not fabricate state.
  await syncAndVerifyBeforeGenerate(tab, { ...payload, prompt });

  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    // After a successful attach, bring the page to the front so the renderer
    // produces a real layout (non-zero viewport) that Input.dispatchMouseEvent
    // coordinates can target. Without this the tab can stay backgrounded even
    // after chrome.tabs.update across a debugger session.
    await ensureInputReachable(target);
  } catch (error) {
    // debugger may be unavailable (DevTools open / remote port in use) — fall back
    // to content script UI path. Record *why*: an external CDP client on the same
    // tab (a probe script, DevTools) silently stealing the debugger from a live run
    // is a real failure mode we have hit, and without this the run looks like an
    // ordinary provider timeout instead of "the pipeline never used CDP at all".
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
    const clickAt = async (x: number, y: number): Promise<void> => {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y,
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
      });
    };

    // The Google Flow prompt composer has a Radix model picker with two modes:
    // Image ("Nano Banana 2") for Text-to-Image and Video ("Video · …") for
    // Image-to-Video. The chip does NOT auto-switch based on the selected
    // upstream media, so we must explicitly choose the right mode per kind.
    const setComposerMode = async (kind: string): Promise<string> => {
      const wantVideo = isVideoKind(kind);
      const modeResult = await evalOnPage<{ ok?: boolean; reason?: string; text?: string }>(`
        (async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const isChip = (b) => {
            const t = (b.innerText || '').replace(/\\s+/g, ' ');
            const isTrigger = b.getAttribute('aria-haspopup') === 'menu'
              || b.classList.contains('settings-trigger-button');
            return isTrigger && (t.includes('Video ·') || t.includes('Nano Banana'));
          };
          const readChip = () => {
            const chip = Array.from(document.querySelectorAll('button')).find(isChip);
            if (!chip) return null;
            const t = (chip.innerText || '').replace(/\\s+/g, ' ').trim();
            return { isVideo: t.includes('Video ·'), text: t };
          };
          const fire = (el) => {
            ['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach((type) => {
              const C = type.startsWith('pointer') ? PointerEvent : MouseEvent;
              el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
            });
          };
          const chip = Array.from(document.querySelectorAll('button')).find(isChip);
          if (!chip) return { ok: false, reason: 'no-model-chip' };
          const cur = readChip();
          if (cur && cur.isVideo === ${wantVideo}) return { ok: true, text: cur.text };

          fire(chip);
          await sleep(800);
          // Legacy Radix [role=tab] plus new Angular Material [role=radio].
          const tabs = Array.from(document.querySelectorAll('[role="tab"], [role="radio"]'));
          const tab = tabs.find((t) => {
            const txt = (t.innerText || '').toLowerCase();
            return ${wantVideo} ? txt.includes('video') : (txt.includes('hình ảnh') || txt.includes('image'));
          });
          if (!tab) {
            return { ok: false, reason: 'mode-tab-not-found', tabs: tabs.map((t) => (t.innerText || '').trim().slice(0, 40)) };
          }
          fire(tab);
          await sleep(800);
          const menu = document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]');
          if (menu) menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          await sleep(400);
          const after = readChip();
          const ok = !!after && after.isVideo === ${wantVideo};
          return { ok, text: (after?.text || ''), wantVideo: ${wantVideo} };
        })()
      `);
      if (!modeResult?.ok) {
        throw bridgeError(
          'MEDIA_FAILED',
          `Could not switch Flow composer to ${wantVideo ? 'Video' : 'Image'} mode (${modeResult?.reason ?? 'unknown'}).`,
          true,
        );
      }
      return modeResult.text ?? '';
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
      await clickAt(pos.x, pos.y);
      for (let k = 0; k < 15; k += 1) {
        await new Promise((r) => setTimeout(r, 400));
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
            await new Promise((r) => setTimeout(r, 500));
          }
          return '';
        })()`)) ?? '';
        await chrome.debugger.sendCommand(target, 'Page.navigate', { url: galleryUrl }).catch(() => {});
        await new Promise((r) => setTimeout(r, 3000));
        return { mediaId: m[1], editorPrompt };
      }
      await chrome.debugger.sendCommand(target, 'Page.navigate', { url: galleryUrl }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
      return undefined;
    };

    try {
      const beforeIds = (await readMediaIds()) ?? [];
      // Per-tile poster tokens in DOM order. The array shape (not a deduped set)
      // is deliberate: a poster can still be '' while it lazy-loads, so the length
      // doubles as the video-tile count and the first extra entry is the new tile.
      const beforeVidTokens = (await readVideoPosterTokens()) ?? [];

      // Explicitly set the composer mode before interacting with media / prompt.
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
        await new Promise((resolve) => setTimeout(resolve, 500));

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
        await new Promise((resolve) => setTimeout(resolve, 600));

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
        await new Promise((resolve) => setTimeout(resolve, 900));

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
      const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim();
      let promptCommitted = Boolean(await evalOnPage<boolean>(`(() => {
        const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
          || document.querySelector('.ProseMirror[contenteditable="true"]')
          || document.querySelector('[role="textbox"][contenteditable="true"]');
        const text = (ed?.textContent || '').replace(/\\s+/g, ' ').trim();
        return text === ${JSON.stringify(prompt.replace(/\s+/g, ' ').trim())};
      })()`));
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
          await chrome.debugger.sendCommand(target, 'Input.insertText', { text: prompt });
        }
      }

      // Wait until the visible editor really contains the prompt, then give Flow
      // a short stabilization window before clicking Generate.
      const promptDeadline = Date.now() + 4_000;
      while (Date.now() < promptDeadline) {
        promptCommitted = Boolean(await evalOnPage<boolean>(`(() => {
          const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
            || document.querySelector('.ProseMirror[contenteditable="true"]')
            || document.querySelector('[role="textbox"][contenteditable="true"]');
          const text = (ed?.textContent || '').replace(/\\s+/g, ' ').trim();
          return text === ${JSON.stringify(normalizedPrompt)};
        })()`));
        if (promptCommitted) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (!promptCommitted) {
        throw bridgeError('INVALID_INPUT', 'Google Flow prompt editor did not commit the requested prompt.', true);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      const generateButton = await evalOnPage<{
        ok?: boolean;
        reason?: string;
        x?: number;
        y?: number;
      }>(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const gen = buttons.find((button) => {
          // New Angular Flow UI (flow.google.com): submit button carries
          // aria-label "Bắt đầu tạo"/"Start creating" and class generate-icon-button.
          const aria = (button.getAttribute('aria-label') || '').trim().toLowerCase();
          if (button.classList.contains('generate-icon-button')
            || /bắt đầu tạo|start creat|begin creat/.test(aria)) {
            return true;
          }
          // Legacy labs.google/fx UI: arrow_forward google-symbols icon.
          const icon = Array.from(button.querySelectorAll('i.google-symbols, .google-symbols'))
            .find((candidate) => (candidate.textContent || '').trim() === 'arrow_forward');
          return Boolean(icon);
        });
        if (!gen) return { ok: false, reason: 'generate-button-not-found' };
        if (gen.disabled || gen.getAttribute('aria-disabled') === 'true') {
          return { ok: false, reason: 'generate-button-disabled' };
        }
        gen.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        // Scrolling can change the button coordinates. Read the rect only after
        // Flow has brought the control into its final visible position.
        const rect = gen.getBoundingClientRect();
        if (!rect.width || !rect.height) return { ok: false, reason: 'generate-button-not-visible' };
        return {
          ok: true,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      })()`);

      if (!generateButton?.ok || generateButton.x === undefined || generateButton.y === undefined) {
        throw bridgeError(
          'INVALID_INPUT',
          `Google Flow Generate button is not ready (${generateButton?.reason ?? 'unknown'}).`,
          true,
        );
      }

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

      const clickAtCenter = async (x: number, y: number) => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x,
          y,
        });
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button: 'left',
          buttons: 1,
          clickCount: 1,
        });
        // Keep the button depressed briefly so Flow receives a complete pointer click.
        await new Promise((resolve) => setTimeout(resolve, 80));
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        });
      };

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
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
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
        await clickAtCenter(fresh.x, fresh.y);
        for (let settle = 0; settle < 12 && !submitAccepted; settle += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
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
          await clickAtCenter(fresh.x, fresh.y - 60);
          await new Promise((resolve) => setTimeout(resolve, 300));
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          });
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
          });
          for (let settle = 0; settle < 8 && !submitAccepted; settle += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
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
        await new Promise((r) => setTimeout(r, 4000));
        const elapsed = Date.now() - startMs;
        waitTick += 1;
        if (!wantVideo) {
          // Images still expose their raw UUID via [data-media-id] in the gallery.
          const current = (await readMediaIds()) ?? [];
          const newId = current.find((id) => !initialSet.has(id));
          if (newId) {
            const previewUrl = await resolveRedirectSafe(newId, 'IMAGE');
            return { mediaId: newId, type: 'IMAGE', projectId: payload.projectId, previewUrl, completedViaUi: true };
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
        return { mediaId: matched.mediaId, type: 'VIDEO', projectId: payload.projectId, previewUrl, completedViaUi: true };
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

  // Path 2: Content script UI fallback (when CDP attach is unavailable)
  // This path is strictly weaker than the CDP path: it cannot dispatch real
  // pointer input, so a failure here must never look like a provider timeout.
  // Prefix the reason the debugger was unavailable (e.g. "Another debugger is
  // already attached to the tab." means a probe script or DevTools stole it).
  const reply = await timeoutable(
    chrome.tabs.sendMessage(tabId, {
      type: 'FLOWGRAPH_UI_GENERATE',
      prompt,
      kind: payload.kind,
      startImageMediaId: payload.startImage?.mediaId,
    }),
    // The content script runs its own submit + media wait, so this has to cover
    // the longest legitimate render rather than the old flat 180s.
    MEDIA_WAIT_VIDEO_MS,
  );
  if (!reply?.ok || !reply.mediaId) {
    const why = attached ? '' : ` [CDP unavailable${attachFailure ? `: ${attachFailure}` : ''}; used content-script fallback]`;
    throw bridgeError(
      reply?.code ?? 'MEDIA_FAILED',
      `${reply?.message ?? 'UI generation failed via content script'}${why}`,
      true,
    );
  }
  const previewUrl = await resolveRedirectSafe(reply.mediaId as string);
  return {
    mediaId: reply.mediaId as string,
    type: (reply.type as 'IMAGE' | 'VIDEO') ?? (isVideoKind(payload.kind) ? 'VIDEO' : 'IMAGE'),
    projectId: payload.projectId,
    previewUrl,
  };
}

async function handleMediaStatus(payload: MediaStatusPayload): Promise<MediaStatusData> {
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

async function handleMediaUpload(payload: MediaUploadPayload): Promise<NormalizedMediaRef> {
  const json = await aisandboxFetch('flow/uploadImage', buildUploadRequest(
    payload.projectId,
    payload.imageBytesBase64,
    payload.mimeType,
    payload.fileName,
  )) as Partial<AiSandboxResponse>;
  const media = json.media?.[0];
  if (!media?.name) throw bridgeError('MEDIA_FAILED', 'Upload returned no media id', false);
  return {
    mediaId: media.name,
    type: 'IMAGE',
    projectId: media.projectId ?? payload.projectId,
    workflowId: media.workflowId,
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
        return makeResponse(request.requestId, { projectId: payload.projectId, selectedAt: new Date().toISOString() });
      }
      case 'FLOWGRAPH_MEDIA_UPLOAD':
        return makeResponse(request.requestId, await handleMediaUpload(request.payload as MediaUploadPayload));
      case 'FLOWGRAPH_GENERATE':
        return makeResponse(request.requestId, await handleGenerate(request.payload as GeneratePayload));
      case 'FLOWGRAPH_MEDIA_STATUS':
        return makeResponse(request.requestId, await handleMediaStatus(request.payload as MediaStatusPayload));
      case 'FLOWGRAPH_MEDIA_DOWNLOAD':
        return makeResponse(request.requestId, await downloadMedia(request.payload as MediaDownloadPayload));
      case 'FLOWGRAPH_CANCEL':
        return makeResponse(request.requestId, await handleCancel(request.payload as { projectId: string; mediaId: string }));
      case 'FLOWGRAPH_SYNC_SET_BATCH':
      case 'FLOWGRAPH_SYNC_SET_BATCH_COUNT':
        return makeResponse(request.requestId, await forwardSyncWrite(request));
      default:
        return makeError(request.requestId, 'UNSUPPORTED_MESSAGE', `Unsupported message type: ${request.type}`);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
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
const SYNC_FOREGROUND_TYPES = new Set<string>([
  'FLOWGRAPH_SYNC_SET_MODE',
  'FLOWGRAPH_SYNC_SET_MODEL',
  'FLOWGRAPH_SYNC_SET_ASPECT_RATIO',
  'FLOWGRAPH_SYNC_SET_BATCH',
  'FLOWGRAPH_SYNC_SET_BATCH_COUNT',
  'FLOWGRAPH_SYNC_SET_DURATION',
  'FLOWGRAPH_SYNC_SET_RESOLUTION',
  'FLOWGRAPH_SYNC_BIND_MEDIA',
  'FLOWGRAPH_SYNC_START_FRAME',
  'FLOWGRAPH_SYNC_END_FRAME',
  'FLOWGRAPH_SYNC_REFERENCE_MEDIA',
]);

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
  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
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
  if (tab.id === undefined || tab.windowId === undefined) return;
  try {
    const win = await chrome.windows.get(tab.windowId);
    const MIN_DESKTOP_WIDTH = 1280;
    if ((win.width ?? 0) >= MIN_DESKTOP_WIDTH) return;
    const targetWidth = Math.max(win.width ?? MIN_DESKTOP_WIDTH, MIN_DESKTOP_WIDTH + 320);
    await chrome.windows.update(tab.windowId, {
      width: targetWidth,
      state: win.state === 'minimized' ? 'normal' : win.state,
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
  } catch {
    // Best-effort: if the window cannot be resized the downstream tile probe
    // will still surface a clear MEDIA_FAILED reason.
  }
}

async function bindRealtimeStartImage(
  tab: chrome.tabs.Tab,
  mediaId: string,
): Promise<{ ok: true; mediaId: string }> {
  if (tab.id === undefined || !mediaId) {
    throw bridgeError('INVALID_VALUE', 'Start Frame requires an exact mediaId.', false);
  }
  await ensureDesktopViewport(tab);
  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
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
  const clickAt = async (x: number, y: number) => {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
    });
  };
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
      const matches = [...document.querySelectorAll('img, video, a, [data-media-id]')]
        .filter((element) => [
          element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'),
          element.currentSrc, element.src, element.href,
        ].filter(Boolean).some((value) => String(value).includes(mediaId)))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
      const media = matches[0]?.element;
      if (!media) return { ok: false, reason: 'source-media-not-found' };
      const card = media.closest?.('[role="button"]') || media.parentElement;
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

    const more = await evaluate<{ ok: boolean; x?: number; y?: number; reason?: string }>(`((mediaId) => {
      const media = [...document.querySelectorAll('img, video, a, [data-media-id]')].find((element) => [
        element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'),
        element.currentSrc, element.src, element.href,
      ].filter(Boolean).some((value) => String(value).includes(mediaId)));
      // New Angular Flow UI nests the tile actions inside a <flow-tile-container>
      // custom element several levels above the <img>; legacy UI used [role=button].
      const card = media?.closest?.('flow-tile-container') || media?.closest?.('[role="button"]') || media?.parentElement;
      const scopes = [card, card?.parentElement, card?.parentElement?.parentElement].filter(Boolean);
      const button = scopes.flatMap((scope) => [...scope.querySelectorAll('button')]).find((candidate) =>
        [...candidate.querySelectorAll('i.google-symbols, .google-symbols, mat-icon, i.material-icons')]
          .some((icon) => (icon.textContent || '').trim() === 'more_vert')
          || candidate.classList.contains('mat-mdc-menu-trigger')
      );
      if (!button) return { ok: false, reason: 'more-vert-not-found' };
      const rect = button.getBoundingClientRect();
      return rect.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false, reason: 'more-vert-not-visible' };
    })(${JSON.stringify(mediaId)})`);
    if (!more.ok || more.x === undefined || more.y === undefined) {
      throw bridgeError('MEDIA_FAILED', `Exact source media ${mediaId} menu was not available (${more.reason ?? 'unknown'}).`, true);
    }
    await clickAt(more.x, more.y);
    await new Promise((resolve) => setTimeout(resolve, 550));

    const animate = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
      const scopes = [...document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content], .cdk-overlay-pane')];
      const item = scopes.flatMap((menu) => [...menu.querySelectorAll('[role="menuitem"], [role="option"], button')])
        .find((candidate) => (candidate.textContent || '').includes('motion_blur') || /Tạo ảnh động|Animate/i.test(candidate.innerText || ''));
      if (!item) return { ok: false };
      const rect = item.getBoundingClientRect();
      return rect.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false };
    })()`);
    if (!animate.ok || animate.x === undefined || animate.y === undefined) {
      throw bridgeError('MEDIA_FAILED', `Flow Animate action was not found for ${mediaId}.`, true);
    }
    await clickAt(animate.x, animate.y);
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
  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
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
  const clickAt = async (x: number, y: number) => {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
    });
  };
  const endBoundExpression = `((mediaId) => {
    const swap = [...document.querySelectorAll('button')].find((button) =>
      [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
        .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
    const endSlot = swap?.nextElementSibling;
    return [...(endSlot?.querySelectorAll('img, video, [data-media-id]') || [])].some((element) =>
      [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
        .filter(Boolean).some((value) => String(value).includes(mediaId)));
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
          return directId === mediaId || src.includes(mediaId) || (token && src.includes(token));
        })
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
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
  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
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
  const clickAt = async (x: number, y: number) => {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
    });
  };

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
  await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
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
  const clickAt = async (point: { x: number; y: number }): Promise<void> => {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: point.x, y: point.y,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
    });
  };
  const referenceIdsExpression = `(() => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
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

    // Select the Video/Components subtype through stable role/text semantics.
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
    }).catch(() => undefined);
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
    }).catch(() => undefined);
    const chip = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
      const button = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
        .find((candidate) => /Video ·/.test(candidate.innerText || ''));
      const rect = button?.getBoundingClientRect();
      return button && rect?.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false };
    })()`);
    if (!chip.ok || chip.x === undefined || chip.y === undefined) {
      throw bridgeError('UI_NOT_READY', 'Flow Video settings chip was not available for Reference Media.', true);
    }
    await clickAt({ x: chip.x, y: chip.y });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const componentTab = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((candidate) => /Thành phần|Components?/i.test(candidate.innerText || ''));
      const rect = tab?.getBoundingClientRect();
      return tab && rect?.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false };
    })()`);
    if (!componentTab.ok || componentTab.x === undefined || componentTab.y === undefined) {
      throw bridgeError('NO_UI_COUNTERPART', 'Google Flow does not expose a Components reference tab.', false);
    }
    await clickAt({ x: componentTab.x, y: componentTab.y });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const componentSelected = await evaluate<boolean>(`(() => [...document.querySelectorAll('[role="tab"]')]
      .some((candidate) => /Thành phần|Components?/i.test(candidate.innerText || '')
        && candidate.getAttribute('aria-selected') === 'true'))()`);
    if (!componentSelected) {
      throw bridgeError('UI_NOT_READY', 'Flow Components reference tab did not commit.', true);
    }
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
    }).catch(() => undefined);
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));

    for (const mediaId of mediaIds) {
      const addTrigger = await evaluate<{ ok: boolean; x?: number; y?: number }>(`(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) =>
          [...candidate.querySelectorAll('i.google-symbols, .google-symbols')]
            .some((icon) => (icon.textContent || '').trim() === 'add_2'));
        const rect = button?.getBoundingClientRect();
        return button && rect?.width && rect.height
          ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { ok: false };
      })()`);
      if (!addTrigger.ok || addTrigger.x === undefined || addTrigger.y === undefined) {
        throw bridgeError('UI_NOT_READY', 'Flow Reference Media picker trigger was not available.', true);
      }
      await clickAt({ x: addTrigger.x, y: addTrigger.y });
      await new Promise((resolve) => setTimeout(resolve, 350));

      const option = await evaluate<{ ok: boolean; selected?: boolean; x?: number; y?: number }>(`((mediaId) => {
        const dialog = [...document.querySelectorAll('[role="dialog"]')]
          .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
        const media = [...(dialog?.querySelectorAll('img, video, [data-media-id]') || [])]
          .find((element) => [
            element.getAttribute?.('data-media-id'), element.getAttribute?.('src'),
            element.currentSrc, element.src,
          ].filter(Boolean).some((value) => String(value).includes(mediaId)));
        const row = media?.closest?.('[role="option"]');
        const rect = row?.getBoundingClientRect();
        return row && rect?.width && rect.height
          ? { ok: true, selected: row.getAttribute('aria-selected') === 'true', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { ok: false };
      })(${JSON.stringify(mediaId)})`);
      if (!option.ok || option.x === undefined || option.y === undefined) {
        throw bridgeError('MEDIA_FAILED', `Exact Reference Media ${mediaId} was not found in the Flow picker.`, true);
      }
      if (!option.selected) {
        await clickAt({ x: option.x, y: option.y });
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const addButton = await evaluate<{ ok: boolean; x?: number; y?: number; reason?: string }>(`(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"]')]
          .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
        const button = [...(dialog?.querySelectorAll('button') || [])]
          .find((candidate) => /Thêm vào câu lệnh|Add to prompt/i.test(candidate.innerText || ''));
        if (!button) return { ok: false, reason: 'add-button-not-found' };
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
          return { ok: false, reason: 'add-button-disabled' };
        }
        const rect = button.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (!addButton.ok || addButton.x === undefined || addButton.y === undefined) {
        throw bridgeError('UI_NOT_READY', `Flow could not commit Reference Media ${mediaId} (${addButton.reason ?? 'unknown'}).`, true);
      }
      await clickAt({ x: addButton.x, y: addButton.y });
      await new Promise((resolve) => setTimeout(resolve, 550));
      const applied = await evaluate<string[]>(referenceIdsExpression);
      if (!applied.includes(mediaId)) {
        throw bridgeError('MEDIA_FAILED', `Flow did not bind exact Reference Media ${mediaId}.`, true);
      }
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

async function forwardSyncWrite(request: BridgeRequest): Promise<BridgeResponse<unknown>> {
  const tab = await findFlowTab();
  if (!tab?.id) return makeError(request.requestId, 'NO_FLOW_TAB', 'No Google Flow tab is open.', false);
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const requestedProjectId = typeof payload.projectId === 'string' ? payload.projectId : undefined;
  const tabProjectId = projectIdFromUrl(tab.url ?? '');
  if (!requestedProjectId) {
    return makeError(request.requestId, 'PROJECT_REQUIRED', 'Realtime sync requires an explicit projectId.', false);
  }
  if (!tabProjectId || tabProjectId !== requestedProjectId) {
    return makeError(
      request.requestId,
      'PROJECT_MISMATCH',
      `Flow tab project ${tabProjectId ?? 'none'} does not match sync project ${requestedProjectId}.`,
      false,
    );
  }
  if (SYNC_FOREGROUND_TYPES.has(request.type) && !tab.active) {
    await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
  }
  if (request.type === 'FLOWGRAPH_SYNC_START_FRAME') {
    const mediaId = typeof (payload.value as { mediaId?: unknown } | undefined)?.mediaId === 'string'
      ? String((payload.value as { mediaId: string }).mediaId)
      : '';
    try {
      return makeResponse(request.requestId, await bindRealtimeStartImage(tab, mediaId));
    } catch (error) {
      const normalized = normalizeError(error);
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
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
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
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
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
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
  ) as { ok?: boolean; code?: string; message?: string } | undefined;
  return reply?.ok
    ? makeResponse(request.requestId, reply)
    : makeError(
        request.requestId,
        reply?.code ?? 'UI_NOT_READY',
        reply?.message ?? 'Google Flow did not apply the realtime sync write.',
        true,
      );
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isSyncRelayMessage(message)) {
    const request = message;
    if (SYNC_WRITE_TYPES.has(request.type)) {
      void forwardSyncWrite(request).then(sendResponse);
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
    void handleRequest(request).then(sendResponse);
    return true;
  }
  return false;
});

// Live gate reactivity: when the Google Flow tab navigates (e.g. project -> home),
// immediately re-read its status and broadcast to the Studio so the canvas gate
// locks/unlocks without waiting for the Studio's 120s poll or a manual reload.
// This is a notification of real Flow-tab state; it does not force-enable anything.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  // Re-read on every relevant navigation: a URL change (SPA project/home) and/or a
  // full page load. Without the `status === 'complete'` case a project navigation
  // would broadcast a transient ERROR during page load.
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  const url = tab?.url ?? changeInfo.url;
  if (!isFlowUrl(url ?? '')) return;
  void (async () => {
    try {
      const flow = await pingFlowTab();
      // pingFlowTab now derives a definitive gate state from the real tab URL even
      // while the content-script relay is still warming up, so a settled navigation
      // always broadcasts the true project state (never a stale READY or a fail-open).
      if (flow.state !== 'READY' && flow.state !== 'PROJECT_REQUIRED') return;
      await chrome.runtime.sendMessage({
        type: 'FLOWGRAPH_EVENT',
        requestId: 'sw:flow:changed',
        payload: { flow },
      }).catch(() => {
        // No Studio page is listening; the next poll or reload will re-read state.
      });
    } catch {
      // Best-effort. The next FLOWGRAPH_FLOW_STATUS request re-reads live state.
    }
  })();
});

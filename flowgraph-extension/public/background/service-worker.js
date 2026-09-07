(() => {
  // src/shared/flowPayloads.ts
  function recaptchaContext(token) {
    return {
      token,
      applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB"
    };
  }
  function clientContext(projectId, token, options = {}) {
    return {
      projectId,
      tool: options.tool ?? "PINHOLE",
      userPaygateTier: options.userPaygateTier ?? "PAYGATE_TIER_ONE",
      sessionId: options.sessionId ?? `;${Date.now()}`,
      recaptchaContext: recaptchaContext(token)
    };
  }
  function mediaGenerationContext(batchId) {
    return {
      batchId,
      audioFailurePreference: "AUDIO_FAILURE_PREFERENCE_UNSPECIFIED"
    };
  }
  var structuredPrompt = (prompt) => ({ parts: [{ text: prompt }] });
  function aspectCode(label) {
    if (!label) return void 0;
    const normalized = label.trim();
    const map = {
      "16:9 (Landscape)": "LANDSCAPE",
      "9:16 (Portrait)": "PORTRAIT",
      "1:1 (Square)": "SQUARE",
      "3:4 (Portrait)": "PORTRAIT_3_4",
      "4:3 (Landscape)": "LANDSCAPE_4_3"
    };
    return map[normalized] ?? normalized.replace("VIDEO_ASPECT_RATIO_", "").replace("IMAGE_ASPECT_RATIO_", "");
  }
  function aspectVideo(ratio) {
    const code = aspectCode(ratio) ?? "LANDSCAPE";
    return `VIDEO_ASPECT_RATIO_${code}`;
  }
  function aspectImage(ratio) {
    const code = aspectCode(ratio) ?? "LANDSCAPE";
    return `IMAGE_ASPECT_RATIO_${code}`;
  }
  function buildT2iRequest(payload, context, batchId) {
    const ctx = context;
    return {
      clientContext: ctx,
      mediaGenerationContext: { batchId },
      useNewMedia: true,
      requests: [{
        clientContext: ctx,
        imageModelName: payload.modelKey,
        imageAspectRatio: aspectImage(payload.aspectRatio),
        structuredPrompt: structuredPrompt(payload.prompt ?? ""),
        seed: payload.seed ?? Math.floor(Math.random() * 1e5),
        imageInputs: []
      }]
    };
  }
  function buildI2vRequest(payload, context, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context,
      useV2ModelConfig: true,
      requests: [{
        aspectRatio: aspectVideo(payload.aspectRatio),
        textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? "") },
        startImage: { mediaId: payload.startImage.mediaId },
        videoModelKey: payload.modelKey,
        seed: payload.seed ?? Math.floor(Math.random() * 1e5),
        metadata: {}
      }]
    };
  }
  function buildT2vRequest(payload, context, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context,
      useV2ModelConfig: true,
      requests: [{
        aspectRatio: aspectVideo(payload.aspectRatio),
        textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? "") },
        videoModelKey: payload.modelKey,
        seed: payload.seed ?? Math.floor(Math.random() * 1e5),
        metadata: {}
      }]
    };
  }
  function buildExtendRequest(payload, context, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context,
      useV2ModelConfig: true,
      requests: [{
        aspectRatio: aspectVideo(payload.aspectRatio),
        textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? "") },
        videoInput: { mediaId: payload.videoInput.mediaId },
        videoModelKey: payload.modelKey,
        seed: payload.seed ?? Math.floor(Math.random() * 1e5),
        metadata: {}
      }]
    };
  }
  function buildUpsampleRequest(payload, context, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context,
      useV2ModelConfig: true,
      requests: [{
        aspectRatio: aspectVideo(payload.aspectRatio),
        videoInput: { mediaId: payload.videoInput.mediaId },
        videoModelKey: payload.modelKey,
        metadata: {}
      }]
    };
  }
  function buildInterpolationRequest(payload, context, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context,
      useV2ModelConfig: true,
      requests: [{
        aspectRatio: aspectVideo(payload.aspectRatio),
        textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? "") },
        startImage: { mediaId: payload.startImage.mediaId },
        endImage: { mediaId: payload.endImage.mediaId },
        videoModelKey: payload.modelKey,
        seed: payload.seed ?? Math.floor(Math.random() * 1e5),
        metadata: {}
      }]
    };
  }
  function buildReferenceRequest(payload, context, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context,
      useV2ModelConfig: true,
      requests: [{
        aspectRatio: aspectVideo(payload.aspectRatio),
        textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? "") },
        referenceImages: payload.imageRefs.map((ref) => ({ mediaId: ref.mediaId, imageUsageType: ref.imageUsageType ?? "IMAGE_USAGE_TYPE_ASSET" })),
        videoModelKey: payload.modelKey,
        seed: payload.seed ?? Math.floor(Math.random() * 1e5),
        metadata: {}
      }]
    };
  }
  function buildUploadRequest(projectId, imageBytesBase64, mimeType, fileName) {
    return {
      clientContext: { projectId, tool: "PINHOLE" },
      imageBytes: imageBytesBase64,
      isUserUploaded: true,
      isHidden: false,
      mimeType,
      fileName
    };
  }
  function buildPollRequest(mediaId, projectId) {
    return { media: [{ name: mediaId, projectId }] };
  }
  function buildCancelRequest(mediaId) {
    return { mediaId };
  }
  function buildCreateProjectRequest(title) {
    return { json: { projectTitle: title, toolName: "PINHOLE" } };
  }

  // src/shared/bridge.ts
  function makeResponse(requestId, data) {
    return { requestId, ok: true, data };
  }
  function makeError(requestId, code, message, retryable = false) {
    return { requestId, ok: false, error: { code, message, retryable } };
  }
  function normalizeError(error) {
    if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
      const candidate = error;
      return {
        code: String(candidate.code ?? "UNKNOWN"),
        message: String(candidate.message ?? "Unknown error"),
        retryable: Boolean(candidate.retryable)
      };
    }
    if (error instanceof Error) return { code: "UNKNOWN", message: error.message, retryable: false };
    return { code: "UNKNOWN", message: String(error), retryable: false };
  }
  function timeoutable(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new BridgeTimeoutError(ms)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
  var BridgeTimeoutError = class extends Error {
    constructor(ms) {
      super(`Bridge request timed out after ${ms}ms`);
      this.ms = ms;
      this.name = "BridgeTimeoutError";
    }
  };

  // src/background/videoTileDetection.ts
  function decideVideoTileArrival(before, now, maxCandidates = 4) {
    const known = new Set(before.tokens.filter(Boolean));
    const unknownIndexes = [];
    const rotatedIndexes = [];
    now.tokens.forEach((token, index) => {
      if (!token) return;
      if (known.has(token)) return;
      unknownIndexes.push(index);
      if (index < before.tokens.length && before.tokens[index]) rotatedIndexes.push(index);
    });
    const grew = now.tokens.length > before.tokens.length;
    const appeared = grew || unknownIndexes.length > 0;
    const candidates = grew ? Array.from(/* @__PURE__ */ new Set([0, ...unknownIndexes, ...now.tokens.map((_, index) => index)])).slice(0, maxCandidates) : appeared ? unknownIndexes.slice(0, maxCandidates) : [];
    return {
      grew,
      appeared,
      unknownIndexes,
      candidates,
      rotated: !grew && rotatedIndexes.length > 0
    };
  }
  function editorPromptMatches(editorPrompt, expectedPrompt) {
    const expected = normalizePrompt(expectedPrompt);
    if (!expected) return false;
    const seen = normalizePrompt(editorPrompt);
    if (!seen) return false;
    return seen.includes(expected.slice(0, Math.min(40, expected.length)));
  }
  function normalizePrompt(value) {
    return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  var EDITOR_PLACEHOLDER_PREFIXES = [
    "m\xF4 t\u1EA3 c\xE1ch ch\u1EC9nh s\u1EEDa",
    "describe how to edit",
    "describe your edit",
    "add a prompt",
    "enter a prompt",
    "nh\u1EADp prompt"
  ];

  // src/shared/timeouts.ts
  var SUBMIT_VERIFY_BUDGET_MS = 4 * 3e4;
  var MEDIA_WAIT_IMAGE_MS = 18e4;
  var MEDIA_WAIT_VIDEO_MS = 42e4;
  var VIDEO_TILE_RECOVERY_STEP_MS = 15e3;
  var VIDEO_TILE_MAX_CANDIDATES = 4;
  var PREFLIGHT_SYNC_BUDGET_MS = 12e4;
  var GENERATE_WORKER_BUDGET_MS = PREFLIGHT_SYNC_BUDGET_MS + SUBMIT_VERIFY_BUDGET_MS + MEDIA_WAIT_VIDEO_MS + VIDEO_TILE_RECOVERY_STEP_MS * VIDEO_TILE_MAX_CANDIDATES;
  var GENERATE_BRIDGE_CEILING_MS = GENERATE_WORKER_BUDGET_MS + 12e4;
  var DOWNLOAD_RESOLVE_BUDGET_MS = 9e4;
  var DOWNLOAD_TRANSFER_BUDGET_MS = 18e4;
  var DOWNLOAD_BRIDGE_CEILING_MS = DOWNLOAD_RESOLVE_BUDGET_MS + DOWNLOAD_TRANSFER_BUDGET_MS + 6e4;

  // src/background/service-worker.ts
  try {
    if (typeof chrome !== "undefined" && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
      });
    }
  } catch {
  }
  var AISANDBOX_BASE = "https://aisandbox-pa.googleapis.com/v1";
  var FX_API_BASE = "https://labs.google/fx/api";
  var TOKEN_TTL_MS = 50 * 60 * 1e3;
  var REQUEST_TIMEOUT_MS = 6e4;
  var SYNC_WRITE_TIMEOUT_MS = 5e3;
  var DOWNLOAD_TIMEOUT_MS = DOWNLOAD_TRANSFER_BUDGET_MS;
  var FLOW_SITEKEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
  var VIDEO_KINDS = /* @__PURE__ */ new Set([
    "i2v",
    "t2v",
    "extend",
    "interpolation",
    "reference",
    "upscale"
  ]);
  function isVideoKind(kind) {
    return VIDEO_KINDS.has(kind);
  }
  var session = null;
  var activeProjectId = null;
  function sessionFresh() {
    return session !== null && Date.now() - session.obtainedAt < TOKEN_TTL_MS;
  }
  async function ensureSession() {
    if (sessionFresh()) return session;
    const tab = await findFlowTab();
    let reply = null;
    if (tab && tab.id !== void 0) {
      try {
        reply = await timeoutable(chrome.tabs.sendMessage(tab.id, { type: "GET_FX_SESSION" }), REQUEST_TIMEOUT_MS);
      } catch {
        reply = null;
      }
    }
    if (!reply?.ok || !reply.token) {
      reply = await fetchSessionDirect();
    }
    if (!reply?.ok || !reply.token) {
      throw bridgeError("AUTH_EXPIRED", reply?.message ?? "Flow session could not be refreshed.", true);
    }
    session = {
      accessToken: reply.token,
      user: reply.user,
      expiresAt: reply.expiresAt ?? "",
      obtainedAt: Date.now()
    };
    return session;
  }
  async function fetchSessionDirect() {
    try {
      const response = await timeoutable(fetch(`${FX_API_BASE}/auth/session`, { method: "GET", credentials: "include" }), REQUEST_TIMEOUT_MS);
      if (!response.ok) return { ok: false, message: `Session fetch failed: HTTP ${response.status}` };
      const data = await response.json();
      if (!data.access_token) return { ok: false, message: "Session response missing access_token" };
      return { ok: true, token: data.access_token, user: { name: data.user?.name, email: data.user?.email }, expiresAt: data.expires };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Direct session fetch failed" };
    }
  }
  function bridgeError(code, message, retryable) {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    return error;
  }
  function bearerHeaders() {
    return {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      Origin: "https://labs.google"
    };
  }
  async function findFlowTab() {
    const tabs = await chrome.tabs.query({});
    const candidates = tabs.filter(
      (tab) => tab.id !== void 0 && isFlowUrl(tab.url ?? "")
    );
    if (candidates.length === 0) return null;
    const score = (tab) => {
      const projectId = projectIdFromUrl(tab.url ?? "");
      if (activeProjectId && projectId === activeProjectId) return 1e3;
      if (tab.active) return 500;
      if (projectId) return 250;
      return 0;
    };
    const chosenTab = candidates.sort(
      (a, b) => score(b) - score(a) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)
    )[0] ?? null;
    if (chosenTab && chosenTab.id !== void 0) {
      void ensureFlowContentScript(chosenTab.id);
    }
    return chosenTab;
  }
  async function ensureFlowContentScript(tabId) {
    try {
      const ping = await timeoutable(chrome.tabs.sendMessage(tabId, { type: "FLOWGRAPH_PING_FLOW" }), 400);
      if (ping) return;
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content/flow-content-script.js"]
        });
      } catch {
      }
    }
  }
  function projectIdFromUrl(url) {
    const match = url.match(/\/project\/([0-9a-f-]{36})/i);
    return match?.[1] ?? void 0;
  }
  function isFlowUrl(url) {
    return url.includes("labs.google/fx") || /^https:\/\/(www\.)?flow\.google\.com\//.test(url);
  }
  async function pingFlowTab() {
    const tab = await findFlowTab();
    if (!tab || tab.id === void 0) {
      return { state: "DISCONNECTED", error: "No Google Flow tab found" };
    }
    try {
      const reply = await timeoutable(chrome.tabs.sendMessage(tab.id, { type: "FLOWGRAPH_PING_FLOW" }), 8e3);
      const status = {
        state: "CONNECTED",
        url: reply?.url ?? tab.url,
        title: reply?.title ?? tab.title,
        projectId: reply?.projectId ?? void 0
      };
      return status.projectId ? { ...status, state: "READY" } : { ...status, state: "PROJECT_REQUIRED" };
    } catch {
      const projectId = projectIdFromUrl(tab.url ?? "");
      return projectId ? { state: "READY", url: tab.url, title: tab.title, projectId } : { state: "PROJECT_REQUIRED", url: tab.url, title: tab.title };
    }
  }
  function mapStatus(st) {
    if (st === "MEDIA_GENERATION_STATUS_ACTIVE" || st === "MEDIA_GENERATION_STATUS_PROCESSING") return "ACTIVE";
    if (st === "MEDIA_GENERATION_STATUS_SUCCESSFUL" || st === "MEDIA_GENERATION_STATUS_COMPLETE") return "SUCCESSFUL";
    if (st === "MEDIA_GENERATION_STATUS_FAILED") return "FAILED";
    if (st === "MEDIA_GENERATION_STATUS_CANCELED") return "CANCELED";
    return "UNKNOWN";
  }
  function providerError(status, body) {
    const code = String(body?.error?.code ?? "");
    const message = String(body?.error?.message ?? `${status}`);
    const combined = `${code} ${message}`;
    if (combined.includes("reCAPTCHA") || combined.includes("UNUSUAL_ACTIVITY")) {
      return bridgeError("CAPTCHA_REQUIRED", message || "reCAPTCHA evaluation failed", true);
    }
    if (status === 401) return bridgeError("AUTH_EXPIRED", message || "Unauthorized", true);
    if (status === 403) {
      if (combined.includes("CREDIT") || combined.includes("QUOTA")) return bridgeError("CREDIT_EXHAUSTED", message || code, false);
      if (combined.startsWith("PUBLIC_ERROR_") || combined.includes("PERMISSION_DENIED")) return bridgeError("PROVIDER_ERROR", message || code, false);
    }
    if (combined.includes("INVALID_ARGUMENT") || combined.includes("Unknown name") || combined.includes("Unknown field")) {
      return bridgeError("INVALID_INPUT", message || code, false);
    }
    return bridgeError("PROVIDER_ERROR", message || `HTTP ${status}`, status >= 500);
  }
  async function aisandboxFetch(path, body, timeoutMs = REQUEST_TIMEOUT_MS) {
    const auth = await ensureSession();
    void auth;
    const response = await timeoutable(
      fetch(`${AISANDBOX_BASE}/${path}`, { method: "POST", headers: bearerHeaders(), body: JSON.stringify(body) }),
      timeoutMs
    );
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
    }
    if (!response.ok) throw providerError(response.status, json);
    return json;
  }
  async function fxApiGet(path) {
    const auth = await ensureSession();
    void auth;
    const response = await timeoutable(fetch(`${FX_API_BASE}/${path}`, { method: "GET", credentials: "include" }), REQUEST_TIMEOUT_MS);
    const json = await response.json().catch(() => null);
    if (!response.ok && !json) throw providerError(response.status, json);
    return json;
  }
  async function fxApiPost(path, body) {
    const auth = await ensureSession();
    void auth;
    const response = await timeoutable(fetch(`${FX_API_BASE}/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }), REQUEST_TIMEOUT_MS);
    const json = await response.json().catch(() => null);
    if (!response.ok && !json) throw providerError(response.status, json);
    return json;
  }
  async function recaptchaToken(projectId) {
    void projectId;
    const tab = await findFlowTab();
    if (!tab || tab.id === void 0) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const results = await timeoutable(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [FLOW_SITEKEY, "FLOW_GENERATE"],
        func: async (sitekey, action) => {
          const pageWindow = window;
          const execute = pageWindow.grecaptcha?.enterprise?.execute;
          if (!execute) return { ok: false, message: "reCAPTCHA Enterprise widget is not ready on the Google Flow page." };
          try {
            const token = await execute(sitekey, { action });
            return token ? { ok: true, token } : { ok: false, message: "reCAPTCHA returned an empty token." };
          } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : "reCAPTCHA execution failed" };
          }
        }
      }),
      2e4
    );
    const reply = results?.[0]?.result;
    if (!reply?.ok || !reply.token) throw bridgeError("CAPTCHA_REQUIRED", reply?.message ?? "reCAPTCHA token unavailable", true);
    return reply.token;
  }
  var ENDPOINT_BY_KIND = {
    t2i: "projects/{projectId}/flowMedia:batchGenerateImages",
    i2v: "video:batchAsyncGenerateVideoStartImage",
    t2v: "video:batchAsyncGenerateVideoText",
    extend: "video:batchAsyncGenerateVideoEditVideo",
    interpolation: "video:batchAsyncGenerateVideoStartAndEndImage",
    reference: "video:batchAsyncGenerateVideoReferenceImages",
    upscale: "video:batchAsyncGenerateVideoUpsampleVideo",
    videoUpscale: "video:batchAsyncGenerateVideoUpsampleVideo",
    imageUpscale: "flow/upsampleImage"
  };
  function endpointFor(payload) {
    const template = ENDPOINT_BY_KIND[payload.kind];
    return template.replace("{projectId}", payload.projectId);
  }
  function buildRequestPayload(payload) {
    const ctx = clientContext(payload.projectId, payload.recaptchaToken ?? "");
    const batchId = crypto.randomUUID();
    switch (payload.kind) {
      case "t2i":
        return buildT2iRequest(payload, ctx, batchId);
      case "i2v": {
        if (!payload.startImage) throw bridgeError("INVALID_INPUT", "i2v requires a start image mediaId", false);
        return buildI2vRequest(payload, ctx, batchId);
      }
      case "t2v":
        return buildT2vRequest(payload, ctx, batchId);
      case "extend": {
        if (!payload.videoInput) throw bridgeError("INVALID_INPUT", "extend requires a video input mediaId", false);
        return buildExtendRequest(payload, ctx, batchId);
      }
      case "interpolation": {
        if (!payload.startImage || !payload.endImage) throw bridgeError("INVALID_INPUT", "interpolation requires start and end images", false);
        return buildInterpolationRequest(payload, ctx, batchId);
      }
      case "reference": {
        const refs = payload.imageRefs ?? [];
        if (!refs.length) throw bridgeError("INVALID_INPUT", "reference requires at least one image", false);
        return buildReferenceRequest(payload, ctx, batchId);
      }
      case "upscale":
      case "videoUpscale": {
        if (!payload.videoInput) throw bridgeError("INVALID_INPUT", "upscale requires a video input mediaId", false);
        return buildUpsampleRequest(payload, ctx, batchId);
      }
      case "imageUpscale": {
        const mediaId = payload.imageRefs?.[0]?.mediaId || payload.mediaId;
        if (!mediaId) throw bridgeError("INVALID_INPUT", "imageUpscale requires an image mediaId", false);
        let targetResolution = payload.targetResolution || "UPSAMPLE_IMAGE_RESOLUTION_2K";
        if (targetResolution === "2K") targetResolution = "UPSAMPLE_IMAGE_RESOLUTION_2K";
        if (targetResolution === "4K") targetResolution = "UPSAMPLE_IMAGE_RESOLUTION_4K";
        return {
          mediaId,
          targetResolution,
          clientContext: ctx
        };
      }
      default:
        throw bridgeError("UNSUPPORTED_KIND", `Unsupported generation kind: ${payload.kind}`, false);
    }
  }
  async function generateApi(payload) {
    const token = await recaptchaToken(payload.projectId);
    const withToken = { ...payload, recaptchaToken: token };
    const body = buildRequestPayload(withToken);
    const json = await aisandboxFetch(endpointFor(payload), body);
    const media = json.media?.[0];
    if (!media?.name) throw bridgeError("MEDIA_FAILED", "Provider returned no media id", false);
    const imageFife = media.image?.generatedImage?.fifeUrl;
    const previewUrl = imageFife ? await resolveMediaUrl(media.name, "IMAGE").catch(() => imageFife) : void 0;
    const isImageOutput = payload.kind === "t2i" || payload.kind === "imageUpscale";
    return {
      mediaId: media.name,
      type: isImageOutput ? "IMAGE" : "VIDEO",
      projectId: media.projectId ?? payload.projectId,
      workflowId: media.workflowId ?? json.workflows?.[0]?.name,
      previewUrl
    };
  }
  async function pollOnce(payload, resolvePreview = false) {
    const json = await aisandboxFetch("video:batchCheckAsyncVideoGenerationStatus", buildPollRequest(payload.mediaId, payload.projectId));
    const item = json.media?.[0];
    const rawStatus = String(item?.mediaMetadata?.mediaStatus?.mediaGenerationStatus ?? "");
    const status = mapStatus(rawStatus);
    const data = {
      status,
      remainingCredits: json.remainingCredits
    };
    if (status !== "SUCCESSFUL") {
      if (status === "FAILED") data.errorMessage = rawStatus;
      return data;
    }
    if (item && resolvePreview) {
      const previewUrl = await resolveRedirectSafe(payload.mediaId, item.video ? "VIDEO" : "IMAGE");
      data.media = {
        mediaId: payload.mediaId,
        type: item.video ? "VIDEO" : "IMAGE",
        projectId: item.projectId ?? payload.projectId,
        workflowId: item.workflowId,
        previewUrl
      };
    }
    return data;
  }
  async function resolveMediaUrl(mediaId, mediaType) {
    const tab = await findFlowTab();
    if (!tab || tab.id === void 0) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    if (mediaType === "VIDEO") {
      return timeoutable(
        resolveVideoUrlViaDebugger(tab.id, tab.url, mediaId),
        DOWNLOAD_RESOLVE_BUDGET_MS
      );
    }
    const results = await timeoutable(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [mediaId],
        func: async (id) => {
          const isAsb = (u) => !!u && u.includes("/asb/");
          const el = document.querySelector(`[data-media-id="${id}"]`);
          if (el) {
            const img = el.tagName === "IMG" ? el : el.querySelector("img");
            const s = img ? img.currentSrc || img.getAttribute("src") : null;
            if (s) return { ok: true, url: s };
          }
          const editorImg = Array.from(document.querySelectorAll("img")).find((i) => (isAsb(i.currentSrc || i.src) || (i.src || "").includes("flow-content.google")) && (i.naturalWidth > 600 || (i.src || "").includes("=s1600")));
          if (editorImg) {
            return { ok: true, url: editorImg.currentSrc || editorImg.src };
          }
          const v = Array.from(document.querySelectorAll("video")).find(
            (el2) => (el2.currentSrc || el2.src || "").includes(id)
          );
          if (v) return { ok: true, url: v.currentSrc || v.src };
          return { ok: false, message: "Could not find a same-origin /asb/ URL for this media on the Flow page." };
        }
      }),
      DOWNLOAD_TIMEOUT_MS
    );
    const reply = results?.[0]?.result;
    if (!reply?.ok || !reply.url) throw bridgeError("MEDIA_FAILED", reply?.message ?? "Could not resolve media url", false);
    return reply.url;
  }
  async function ensureInputReachable(target) {
    await chrome.debugger.sendCommand(target, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => void 0);
    await chrome.debugger.sendCommand(target, "Page.bringToFront").catch(() => void 0);
  }
  async function resolveVideoUrlViaDebugger(tabId, galleryUrl, mediaId) {
    const target = { tabId };
    let attachedHere = false;
    let projectUrl = "";
    try {
      await chrome.debugger.attach(target, "1.3");
      attachedHere = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/already attached/i.test(msg)) {
        throw bridgeError("MEDIA_FAILED", `Could not attach debugger to resolve video: ${msg}`, false);
      }
    }
    try {
      await ensureInputReachable(target);
      const evalOnPage = async (expression) => {
        try {
          const res = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true
          });
          return res?.result?.value;
        } catch {
          return void 0;
        }
      };
      const clickAt = async (x, y) => {
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          buttons: 1,
          clickCount: 1
        });
        await new Promise((r) => setTimeout(r, 80));
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          buttons: 0,
          clickCount: 1
        });
      };
      const editUrl = galleryUrl ? `${galleryUrl.replace(/\/edit\/[^/]+.*$/, "")}/edit/${mediaId}` : "";
      projectUrl = galleryUrl ? galleryUrl.replace(/\/edit\/[^/]+.*$/, "") : "";
      const downloadBtnXY = () => evalOnPage(
        `(()=>{const b=[...document.querySelectorAll('flow-video-tile button')].find((x)=>{const a=(x.getAttribute('aria-label')||'').toLowerCase();const i=x.querySelector('mat-icon,i');return /download|t\u1EA3i/.test(a)||(i&&i.textContent.trim()==='download')});if(!b)return null;const r=b.getBoundingClientRect();if(r.width<2)return null;return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
      );
      const waitForButton = async (ms) => {
        const deadline = Date.now() + ms;
        for (; ; ) {
          const found = await downloadBtnXY();
          if (found) return found;
          if (Date.now() > deadline) return null;
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      const here = await evalOnPage("location.href");
      if (editUrl && !(here || "").includes(`/edit/${mediaId}`)) {
        await chrome.debugger.sendCommand(target, "Page.navigate", { url: editUrl }).catch(() => {
        });
        await waitForButton(2e4);
      }
      let signedUrl = "";
      const isSignedVideo = (url) => /\/video\/[0-9a-f-]{20,}\?/i.test(url) && !/\.gif/i.test(url);
      const onDebuggerEvent = (source, method, params) => {
        if (signedUrl || source.tabId !== tabId || method !== "Network.requestWillBeSent") return;
        const url = params?.request?.url ?? "";
        if (isSignedVideo(url)) signedUrl = url;
      };
      chrome.debugger.onEvent.addListener(onDebuggerEvent);
      const pausedCopy = (source, method, params) => {
        if (source.tabId !== tabId || method !== "Fetch.requestPaused") return;
        const p = params;
        const requestId = p?.requestId;
        if (!requestId) return;
        const url = p?.request?.url ?? "";
        if (isSignedVideo(url)) signedUrl = url;
        void chrome.debugger.sendCommand(target, "Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => void 0);
      };
      chrome.debugger.onEvent.addListener(pausedCopy);
      try {
        await chrome.debugger.sendCommand(target, "Network.enable").catch(() => {
        });
        await chrome.debugger.sendCommand(target, "Fetch.enable", {
          patterns: [{ urlPattern: "https://flow-content.google/video/*", requestStage: "Request" }]
        }).catch(() => {
        });
        const openMenuAndPick = async () => {
          const btn = await downloadBtnXY();
          if (!btn) return false;
          await clickAt(btn.x, btn.y);
          await new Promise((r) => setTimeout(r, 1200));
          const item = await evalOnPage(
            `(()=>{const its=[...document.querySelectorAll('mat-menu-item,[role="menuitem"]')].filter((x)=>x.getBoundingClientRect().width>2);const pick=its.find((x)=>/720p/i.test(x.textContent))||its.find((x)=>!/gif/i.test(x.textContent))||its[0];if(!pick)return null;const r=pick.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
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
            await chrome.debugger.sendCommand(target, "Page.navigate", { url: editUrl }).catch(() => {
            });
            await waitForButton(15e3);
          }
        }
      } finally {
        chrome.debugger.onEvent.removeListener(onDebuggerEvent);
        chrome.debugger.onEvent.removeListener(pausedCopy);
        await chrome.debugger.sendCommand(target, "Fetch.disable").catch(() => {
        });
        await chrome.debugger.sendCommand(target, "Network.disable").catch(() => {
        });
      }
      if (signedUrl) return signedUrl;
      throw bridgeError("MEDIA_FAILED", "Could not resolve a signed video URL for this media on the Flow page.", false);
    } finally {
      if (attachedHere) {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
      if (projectUrl) {
        try {
          const current = await chrome.tabs.get(tabId);
          if ((current.url || "").includes("/edit/")) {
            await chrome.tabs.update(tabId, { url: projectUrl });
          }
        } catch {
        }
      }
    }
  }
  async function resolveRedirectSafe(mediaId, mediaType) {
    try {
      return await resolveMediaUrl(mediaId, mediaType);
    } catch {
      return "";
    }
  }
  async function downloadMedia(payload) {
    let url = payload.url;
    if (!url) {
      try {
        url = await resolveMediaUrl(payload.mediaId, payload.mediaType);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    const isVideo = payload.mediaType === "VIDEO" || /video|\.mp4/i.test(url);
    const filename = payload.fileName ? `${payload.fileName}.${isVideo ? "mp4" : "jpg"}` : void 0;
    return timeoutable(
      // Poll the item instead of waiting for `onChanged`. Live run 95a31d7a proved
      // the event path unreliable: the artifact (`flowgraph-output (9).mp4`, id 30)
      // reached state=complete 2.5s after it started, yet the listener never saw a
      // matching delta, so a perfectly good download hung until the 180s worker
      // deadline and surfaced as `PROVIDER_ERROR: Bridge request timed out`.
      // Reading state from `chrome.downloads.search` cannot miss a transition.
      (async () => {
        const downloadId = await chrome.downloads.download({
          url,
          filename,
          saveAs: false,
          conflictAction: "uniquify"
        });
        const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
        for (; ; ) {
          const [item] = await chrome.downloads.search({ id: downloadId });
          if (item?.state === "complete") {
            return { ok: true, downloadId, filename: item.filename };
          }
          if (item?.state === "interrupted") {
            return { ok: false, downloadId, error: item.error ?? "Download interrupted" };
          }
          if (Date.now() > deadline) {
            return { ok: false, downloadId, error: "Download did not finish in time" };
          }
          await new Promise((r) => setTimeout(r, 500));
        }
      })(),
      DOWNLOAD_TIMEOUT_MS
    );
  }
  async function handleAccountStatus() {
    try {
      const tab = await findFlowTab();
      if (tab && tab.id !== void 0) {
        try {
          const injected = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const el = document.querySelector('a.gb_C, [aria-label*="@gmail.com"], [aria-label*="T\xE0i kho\u1EA3n Google" i], [aria-label*="Google Account" i]');
              if (el) {
                const aria = el.getAttribute("aria-label") || "";
                const emailMatch = aria.match(/\(([^)]+@[^)]+)\)/i);
                const nameMatch = aria.match(/Tài khoản Google:\s*([^\n(]+)/i) || aria.match(/Google Account:\s*([^\n(]+)/i);
                return {
                  email: emailMatch ? emailMatch[1].trim() : void 0,
                  name: nameMatch ? nameMatch[1].trim() : void 0
                };
              }
              return null;
            }
          });
          const userFromDom = injected?.[0]?.result;
          if (userFromDom?.email) {
            return {
              state: "CONNECTED",
              email: userFromDom.email,
              name: userFromDom.name
            };
          }
        } catch {
        }
      }
      const auth = await ensureSession();
      return {
        state: "CONNECTED",
        email: auth.user?.email,
        name: auth.user?.name,
        expiresAt: auth.expiresAt
      };
    } catch (error) {
      const normalized = normalizeError(error);
      return {
        state: normalized.code === "AUTH_EXPIRED" ? "SESSION_EXPIRED" : normalized.code === "NO_FLOW_TAB" ? "DISCONNECTED" : "ERROR",
        error: normalized.message
      };
    }
  }
  async function handleCredits() {
    try {
      const auth = await ensureSession();
      const json = await timeoutable(fetch(`${AISANDBOX_BASE}/credits`, { headers: bearerHeaders() }), REQUEST_TIMEOUT_MS);
      const data = await json.json().catch(() => ({}));
      return {
        credits: typeof data.remainingCredits === "number" ? data.remainingCredits : void 0,
        userPaygateTier: typeof data.userPaygateTier === "string" ? data.userPaygateTier : void 0,
        serviceTier: typeof data.serviceTier === "string" ? data.serviceTier : void 0
      };
    } catch (error) {
      const normalized = normalizeError(error);
      return { error: normalized.message };
    }
  }
  function unwrapTrpc(json) {
    const root = json;
    return root?.result?.data?.json?.result;
  }
  async function handleProjectList() {
    const inputParam = encodeURIComponent(JSON.stringify({ json: { pageSize: 20, toolName: "PINHOLE" } }));
    const json = await fxApiGet(`trpc/project.searchUserProjects?input=${inputParam}`);
    const result = unwrapTrpc(json);
    const raw = result?.projects ?? [];
    const projects = raw.map((project) => ({
      projectId: project.projectId,
      projectTitle: typeof project.projectInfo === "string" ? project.projectInfo : project.projectInfo?.projectTitle ?? "Untitled project",
      creationTime: project.creationTime
    }));
    return { projects, source: "runtime" };
  }
  async function handleProjectCreate(projectTitle) {
    const json = await fxApiPost("trpc/project.createProject", buildCreateProjectRequest(projectTitle));
    const result = unwrapTrpc(json);
    if (!result?.projectId) throw bridgeError("PROVIDER_ERROR", "Project create returned no projectId", false);
    activeProjectId = result.projectId;
    return { projectId: result.projectId, projectTitle: result.projectInfo?.projectTitle ?? projectTitle };
  }
  async function syncAndVerifyBeforeGenerate(tab, payload) {
    if (tab.id === void 0) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const tabProjectId = projectIdFromUrl(tab.url ?? "");
    if (!tabProjectId || tabProjectId !== payload.projectId) {
      throw bridgeError(
        "PROJECT_MISMATCH",
        `Flow tab project ${tabProjectId ?? "none"} does not match generation project ${payload.projectId}.`,
        false
      );
    }
    const modeWrite = {
      field: "mode",
      type: "FLOWGRAPH_SYNC_SET_MODE",
      value: isVideoKind(payload.kind) ? "VIDEO" : "IMAGE"
    };
    const settingWrites = [];
    if (payload.modelLabel) settingWrites.push({ field: "model", type: "FLOWGRAPH_SYNC_SET_MODEL", value: payload.modelLabel });
    const aspectRatio = payload.aspectRatio?.match(/\b\d{1,2}:\d{1,2}\b/)?.[0];
    if (aspectRatio) settingWrites.push({ field: "aspectRatio", type: "FLOWGRAPH_SYNC_SET_ASPECT_RATIO", value: aspectRatio });
    if (payload.durationSeconds !== void 0 && Number.isFinite(payload.durationSeconds)) {
      settingWrites.push({ field: "durationSeconds", type: "FLOWGRAPH_SYNC_SET_DURATION", value: payload.durationSeconds, optional: true });
    }
    if (payload.targetResolution && isVideoKind(payload.kind) && /^\d{3,4}p$/i.test(String(payload.targetResolution))) {
      settingWrites.push({ field: "targetResolution", type: "FLOWGRAPH_SYNC_SET_RESOLUTION", value: payload.targetResolution, optional: true });
    }
    const promptWrite = payload.prompt === void 0 ? void 0 : { field: "prompt", type: "FLOWGRAPH_SYNC_SET_PROMPT", value: payload.prompt };
    const limitations = [];
    const applyWrites = async (writes) => {
      for (const write of writes) {
        const syncId = `preflight-${write.field}-${crypto.randomUUID()}`;
        const startedAt = Date.now();
        const reply = await timeoutable(
          chrome.tabs.sendMessage(tab.id, {
            type: write.type,
            requestId: `sw:${syncId}`,
            payload: {
              syncId,
              source: "FLOWGRAPH",
              projectId: payload.projectId,
              value: write.value,
              sequence: startedAt,
              originEventId: syncId
            }
          }),
          REQUEST_TIMEOUT_MS
        );
        if (reply?.ok) {
          console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
            syncId,
            projectId: payload.projectId
          });
          continue;
        }
        if (write.optional && reply?.code === "NO_UI_COUNTERPART") {
          limitations.push(write.field);
          console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT NO_UI_COUNTERPART ${Date.now() - startedAt}ms`, {
            syncId,
            projectId: payload.projectId
          });
          continue;
        }
        throw bridgeError(
          reply?.code ?? "PREFLIGHT_FAILED",
          reply?.message ?? `Google Flow did not verify ${write.field} before Generate.`,
          false
        );
      }
    };
    await applyWrites([modeWrite]);
    if (payload.kind === "t2v") {
      await clearRealtimeFrameBindings(tab, ["startImage", "endImage"]);
    } else if (payload.kind === "i2v") {
      await clearRealtimeFrameBindings(tab, ["endImage"]);
    }
    if (payload.startImage?.mediaId) {
      const startedAt = Date.now();
      await bindRealtimeStartImage(tab, payload.startImage.mediaId);
      console.info(`[FlowGraph Sync] startImage PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
        projectId: payload.projectId
      });
    }
    if (payload.endImage?.mediaId) {
      const startedAt = Date.now();
      await bindRealtimeEndImage(tab, payload.endImage.mediaId);
      console.info(`[FlowGraph Sync] endImage PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
        projectId: payload.projectId
      });
    }
    if (payload.imageRefs && payload.imageRefs.length > 0) {
      const startedAt = Date.now();
      await bindRealtimeReferenceMedia(tab, payload.imageRefs.map((r) => ({ mediaId: r.mediaId })));
      console.info(`[FlowGraph Sync] referenceMedia PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
        projectId: payload.projectId,
        count: payload.imageRefs.length
      });
    }
    if (payload.videoInput?.mediaId) {
      const startedAt = Date.now();
      await bindRealtimeVideoInput(tab, payload.videoInput.mediaId, payload.mode);
      console.info(`[FlowGraph Sync] videoInput PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
        projectId: payload.projectId,
        mediaId: payload.videoInput.mediaId
      });
    }
    await applyWrites(settingWrites);
    if (promptWrite) await applyWrites([promptWrite]);
    return { limitations };
  }
  async function handleGenerate(payload) {
    const tab = await findFlowTab();
    if (!tab || tab.id === void 0) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const tabId = tab.id;
    await ensureFlowContentScript(tabId);
    const expectedProjectId = projectIdFromUrl(tab.url ?? "");
    if (!expectedProjectId || expectedProjectId !== payload.projectId) {
      throw bridgeError(
        "PROJECT_MISMATCH",
        `Active Google Flow tab project (${expectedProjectId || "none"}) does not match request projectId (${payload.projectId}).`,
        false
      );
    }
    const isDirectApiPath = payload.kind === "upscale" || payload.kind === "imageUpscale" || payload.kind === "videoUpscale";
    if (isDirectApiPath) {
      return generateApi(payload);
    }
    const prompt = (payload.prompt ?? "").trim();
    if (!prompt) {
      throw bridgeError(
        "INVALID_INPUT",
        `Refusing to generate: the ${payload.kind ?? "unknown"} node produced an empty prompt. Connect a Prompt node (or set a prompt on the node) instead of letting the UI fall back to a placeholder.`,
        false
      );
    }
    const galleryUrl = (tab.url ?? "").replace(/\/edit\/[0-9a-zA-Z_-]+.*$/, "");
    const target = { tabId };
    let attached = false;
    let attachFailure = "";
    const isBackgroundExecution = true;
    if (!isBackgroundExecution) {
      try {
        await chrome.tabs.update(tabId, { active: true });
      } catch {
      }
    }
    await syncAndVerifyBeforeGenerate(tab, { ...payload, prompt });
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await ensureInputReachable(target);
    } catch (error) {
      attachFailure = normalizeError(error).message;
    }
    if (attached) {
      const evalOnPage = async (expression) => {
        try {
          const res = await chrome.debugger.sendCommand(target, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
          return res?.result?.value;
        } catch {
          return void 0;
        }
      };
      const clickAt = async (x, y) => {
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          buttons: 1,
          clickCount: 1
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          buttons: 0,
          clickCount: 1
        });
      };
      const setComposerMode = async (kind) => {
        const wantVideo = isVideoKind(kind);
        const currentStatus = await evalOnPage(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        const text = btn ? (btn.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase() : '';
        const isVideo = text.includes('video') || text.includes('veo') || text.includes('omni');
        return { isVideo, text };
      })()`);
        if (currentStatus && currentStatus.isVideo === wantVideo) {
          return currentStatus.text;
        }
        const triggerCoords = await evalOnPage(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        if (!btn) return { ok: false };
        const rect = btn.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
        if (triggerCoords?.ok && triggerCoords.x !== void 0 && triggerCoords.y !== void 0) {
          await clickAt(triggerCoords.x, triggerCoords.y);
          await new Promise((r) => setTimeout(r, 400));
        }
        const tabCoords = await evalOnPage(`(() => {
        const pane = document.querySelector('.cdk-overlay-pane');
        const buttons = pane ? Array.from(pane.querySelectorAll('button, [role="tab"], [role="radio"], .mat-button-toggle-button')) : [];
        const wantedTab = buttons.find((b) => {
          const text = (b.innerText || '').toLowerCase();
          return ${wantVideo} ? (text.includes('video') || text.includes('videocam')) : (text.includes('h\xECnh \u1EA3nh') || text.includes('image'));
        });
        if (!wantedTab) {
          return { ok: false, tabs: buttons.map(b => (b.innerText || '').trim().slice(0, 30)) };
        }
        const rect = wantedTab.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
        if (tabCoords?.ok && tabCoords.x !== void 0 && tabCoords.y !== void 0) {
          await clickAt(tabCoords.x, tabCoords.y);
          await new Promise((r) => setTimeout(r, 400));
        }
        await evalOnPage(`(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      })()`);
        await new Promise((r) => setTimeout(r, 200));
        const after = await evalOnPage(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        const text = btn ? (btn.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase() : '';
        const isVideo = text.includes('video') || text.includes('veo') || text.includes('omni');
        return { isVideo, text };
      })()`);
        if (!after || after.isVideo !== wantVideo) {
          throw bridgeError(
            "MEDIA_FAILED",
            `Could not switch Flow composer to ${wantVideo ? "Video" : "Image"} mode.`,
            true
          );
        }
        return after.text;
      };
      const readMediaIds = () => evalOnPage(`
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
      const readVideoPosterTokens = () => evalOnPage(`
      (() => {
        const key = ${POSTER_TOKEN_JS};
        return Array.from(document.querySelectorAll('flow-video-tile')).map((t) => {
          const img = t.querySelector('img');
          return img ? key(img) : '';
        });
      })()
    `);
      const openVideoTileAndGetId = async (pick) => {
        const pos = await evalOnPage(`((sel) => {
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
        if (!pos) return void 0;
        await clickAt(pos.x, pos.y);
        for (let k = 0; k < 15; k += 1) {
          await new Promise((r) => setTimeout(r, 400));
          const href = await evalOnPage(`location.href`);
          const m = href && href.match(/\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
          if (!m || !m[1]) continue;
          const editorPrompt = await evalOnPage(`(async () => {
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
        })()`) ?? "";
          await chrome.debugger.sendCommand(target, "Page.navigate", { url: galleryUrl }).catch(() => {
          });
          await new Promise((r) => setTimeout(r, 3e3));
          return { mediaId: m[1], editorPrompt };
        }
        await chrome.debugger.sendCommand(target, "Page.navigate", { url: galleryUrl }).catch(() => {
        });
        await new Promise((r) => setTimeout(r, 3e3));
        return void 0;
      };
      try {
        const beforeIds = await readMediaIds() ?? [];
        const beforeVidTokens = await readVideoPosterTokens() ?? [];
        await setComposerMode(payload.kind);
        const exactStartAlreadyBound = payload.kind === "i2v" && payload.startImage?.mediaId ? Boolean(await evalOnPage(`((mediaId) => {
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
          })(${JSON.stringify(payload.startImage.mediaId)})`)) : false;
        if (payload.kind === "i2v" && !exactStartAlreadyBound) {
          const startImageId = payload.startImage?.mediaId;
          if (!startImageId) throw bridgeError("INVALID_INPUT", "Image-to-Video requires startImage.mediaId.", false);
          const mediaCenter = await evalOnPage(`((mediaId) => {
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
          if (!mediaCenter?.ok || mediaCenter.x === void 0 || mediaCenter.y === void 0) {
            throw bridgeError(
              "MEDIA_FAILED",
              `Could not locate upstream image ${startImageId} in the Google Flow UI (${mediaCenter?.reason ?? "unknown"}).`,
              true
            );
          }
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: mediaCenter.x,
            y: mediaCenter.y
          });
          await new Promise((resolve) => setTimeout(resolve, 500));
          const moreVert = await evalOnPage(`((mediaId) => {
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
            .find((b) => (b.innerText || '').includes('Kh\xE1c') || (b.textContent || '').includes('more_vert'));
          if (!btn) return { ok: false, reason: 'tile-menu-button-not-found' };
          const rect = btn.getBoundingClientRect();
          if (!rect.width || !rect.height) return { ok: false, reason: 'tile-menu-button-not-visible' };
          return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })(${JSON.stringify(startImageId)})`);
          if (!moreVert?.ok || moreVert.x === void 0 || moreVert.y === void 0) {
            throw bridgeError(
              "MEDIA_FAILED",
              `Upstream image ${startImageId} tile "more_vert" action not found (${moreVert?.reason ?? "unknown"}).`,
              true
            );
          }
          await clickAt(moreVert.x, moreVert.y);
          await new Promise((resolve) => setTimeout(resolve, 600));
          const motionItem = await evalOnPage(`(() => {
          for (const menu of Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content], .cdk-overlay-pane'))) {
            const item = Array.from(menu.querySelectorAll('[role="menuitem"], button'))
              .find((it) => (it.innerText || '').includes('T\u1EA1o \u1EA3nh \u0111\u1ED9ng') || (it.innerText || '').includes('motion_blur'));
            if (item) {
              const rect = item.getBoundingClientRect();
              if (!rect.width || !rect.height) continue;
              return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
          return { ok: false, reason: 'tile-motion-item-not-found' };
        })()`);
          if (!motionItem?.ok || motionItem.x === void 0 || motionItem.y === void 0) {
            throw bridgeError(
              "MEDIA_FAILED",
              `Upstream image ${startImageId} "T\u1EA1o \u1EA3nh \u0111\u1ED9ng" menu item not found (${motionItem?.reason ?? "unknown"}).`,
              true
            );
          }
          await clickAt(motionItem.x, motionItem.y);
          await new Promise((resolve) => setTimeout(resolve, 900));
          const bindCheck = await evalOnPage(`((mediaId) => {
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
              "MEDIA_FAILED",
              `Upstream image ${startImageId} was not bound as the Flow video start image (${bindCheck?.reason ?? "unknown"}).`,
              true
            );
          }
        }
        const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
        let promptCommitted = Boolean(await evalOnPage(`(() => {
        const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
          || document.querySelector('.ProseMirror[contenteditable="true"]')
          || document.querySelector('[role="textbox"][contenteditable="true"]');
        const text = (ed?.textContent || '').replace(/\\s+/g, ' ').trim();
        return text === ${JSON.stringify(prompt.replace(/\s+/g, " ").trim())};
      })()`));
        if (!promptCommitted) {
          await timeoutable(chrome.tabs.sendMessage(tabId, {
            type: "FLOWGRAPH_SYNC_SUPPRESS_ECHO",
            field: "prompt",
            value: normalizedPrompt
          }), 2e3).catch(() => void 0);
          const editor = await evalOnPage(`(() => {
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
          if (editor?.ok && editor.x !== void 0 && editor.y !== void 0) {
            await clickAt(editor.x, editor.y);
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Control",
              code: "ControlLeft",
              windowsVirtualKeyCode: 17
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              key: "a",
              code: "KeyA",
              windowsVirtualKeyCode: 65,
              modifiers: 2
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "a",
              code: "KeyA",
              windowsVirtualKeyCode: 65,
              modifiers: 2
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Control",
              code: "ControlLeft",
              windowsVirtualKeyCode: 17
            });
            await chrome.debugger.sendCommand(target, "Input.insertText", { text: prompt });
          }
        }
        const promptDeadline = Date.now() + 4e3;
        while (Date.now() < promptDeadline) {
          promptCommitted = Boolean(await evalOnPage(`(() => {
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
          throw bridgeError("INVALID_INPUT", "Google Flow prompt editor did not commit the requested prompt.", true);
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const generateButton = await evalOnPage(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const gen = buttons.find((button) => {
          // New Angular Flow UI (flow.google.com): submit button carries
          // aria-label "B\u1EAFt \u0111\u1EA7u t\u1EA1o"/"Start creating" and class generate-icon-button.
          const aria = (button.getAttribute('aria-label') || '').trim().toLowerCase();
          if (button.classList.contains('generate-icon-button')
            || /b\u1EAFt \u0111\u1EA7u t\u1EA1o|start creat|begin creat/.test(aria)) {
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
        if (!generateButton?.ok || generateButton.x === void 0 || generateButton.y === void 0) {
          throw bridgeError(
            "INVALID_INPUT",
            `Google Flow Generate button is not ready (${generateButton?.reason ?? "unknown"}).`,
            true
          );
        }
        const measureGenerateButton = () => evalOnPage(`(() => {
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
        const clickAtCenter = async (x, y) => {
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y
          });
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mousePressed",
            x,
            y,
            button: "left",
            buttons: 1,
            clickCount: 1
          });
          await new Promise((resolve) => setTimeout(resolve, 80));
          await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x,
            y,
            button: "left",
            buttons: 0,
            clickCount: 1
          });
        };
        const promptConsumed = () => evalOnPage(`((expected) => {
          const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
            || document.querySelector('.ProseMirror[contenteditable="true"]')
            || document.querySelector('[role="textbox"][contenteditable="true"]');
          if (!ed) return false;
          const text = (ed.textContent || '').replace(/\\s+/g, ' ').trim();
          return text.length === 0 || !text.includes(expected);
        })(${JSON.stringify(normalizedPrompt)})`);
        let submitAccepted = false;
        const submitTrace = [];
        const composerSnapshot = () => evalOnPage(`(() => {
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
        const composerDiag = () => evalOnPage(`(() => {
          const chip = Array.from(document.querySelectorAll('button'))
            .map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim())
            .find((t) => t.includes('Video \xB7') || t.includes('Nano Banana')) || 'nochip';
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
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
          const measured = await measureGenerateButton();
          submitTrace.push(`a${attempt}:${measured === void 0 ? "EVAL_UNDEF" : `x${Math.round(measured.x ?? -1)}y${Math.round(measured.y ?? -1)}d${measured.disabled ? 1 : 0}h${measured.hitOk ? 1 : 0}`}`);
          const fresh = measured ?? {};
          if (fresh.x === void 0 || fresh.y === void 0) {
            continue;
          }
          if (fresh.disabled) {
            if (await promptConsumed()) {
              submitAccepted = true;
              break;
            }
            continue;
          }
          if (!fresh.hitOk) {
            continue;
          }
          await clickAtCenter(fresh.x, fresh.y);
          for (let settle = 0; settle < 12 && !submitAccepted; settle += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const consumed = await promptConsumed();
            if (settle === 2 || settle === 11) {
              const snap = await composerSnapshot();
              submitTrace.push(`a${attempt}s${settle}:${consumed === void 0 ? "EVAL_UNDEF" : consumed ? "CONSUMED" : "TYPED"}{${snap ?? "noeval"}}`);
            }
            if (consumed) submitAccepted = true;
          }
          if (!submitAccepted) {
            await clickAtCenter(fresh.x, fresh.y - 60);
            await new Promise((resolve) => setTimeout(resolve, 300));
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13
            });
            for (let settle = 0; settle < 8 && !submitAccepted; settle += 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
              if (await promptConsumed()) submitAccepted = true;
            }
            submitTrace.push(`a${attempt}enter:${submitAccepted ? "CONSUMED" : "TYPED"}`);
          }
        }
        if (!submitAccepted) {
          throw bridgeError(
            "PROVIDER_ERROR",
            `Google Flow did not accept the Generate click: the prompt editor never cleared. Trace ${submitTrace.join(" | ")}`,
            true
          );
        }
        const maxWaitMs = isVideoKind(payload.kind) ? MEDIA_WAIT_VIDEO_MS : MEDIA_WAIT_IMAGE_MS;
        const startMs = Date.now();
        let waitTick = 0;
        let lastAttributionMs = 0;
        const initialSet = new Set(beforeIds);
        const wantVideo = isVideoKind(payload.kind);
        const captchaGraceMs = 25e3;
        const detectInteractiveCaptcha = () => evalOnPage(
          `(()=>{for(const f of document.querySelectorAll('iframe')){if(!/recaptcha/i.test(f.src||''))continue;const r=f.getBoundingClientRect();if(r.width<120||r.height<40)continue;const cx=r.x+r.width/2,cy=r.y+r.height/2;if(cx<0||cy<0||cx>=innerWidth||cy>=innerHeight)continue;let el=f,vis=true;while(el){const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0){vis=false;break}el=el.parentElement}if(!vis)continue;const hit=document.elementFromPoint(cx,cy);if(hit&&(hit===f||f.contains(hit)))return true}return false})()`
        );
        while (Date.now() - startMs < maxWaitMs) {
          await new Promise((r) => setTimeout(r, 4e3));
          const elapsed = Date.now() - startMs;
          waitTick += 1;
          if (!wantVideo) {
            const current = await readMediaIds() ?? [];
            const newId = current.find((id) => !initialSet.has(id));
            if (newId) {
              const previewUrl3 = await resolveRedirectSafe(newId, "IMAGE");
              return { mediaId: newId, type: "IMAGE", projectId: payload.projectId, previewUrl: previewUrl3, completedViaUi: true };
            }
            if (elapsed >= captchaGraceMs && await detectInteractiveCaptcha()) {
              throw bridgeError(
                "CAPTCHA_REQUIRED",
                "Google Flow presented an interactive reCAPTCHA challenge for this generation. Solve it in the Flow tab, then run the workflow again.",
                true
              );
            }
            continue;
          }
          const tokens = await readVideoPosterTokens() ?? [];
          const verdict = decideVideoTileArrival(
            { tokens: beforeVidTokens },
            { tokens },
            VIDEO_TILE_MAX_CANDIDATES
          );
          if (!verdict.appeared) {
            if (waitTick % 8 === 0) {
              submitTrace.push(
                `w${Math.round(elapsed / 1e3)}s:vt${tokens.length}${verdict.rotated ? `:rot${verdict.unknownIndexes.length}` : ""}:${await composerDiag() ?? "noeval"}`
              );
            }
            if (elapsed >= captchaGraceMs && await detectInteractiveCaptcha()) {
              throw bridgeError(
                "CAPTCHA_REQUIRED",
                "Google Flow presented an interactive reCAPTCHA challenge for this generation. Solve it in the Flow tab, then run the workflow again.",
                true
              );
            }
            continue;
          }
          submitTrace.push(
            `w${Math.round(elapsed / 1e3)}s:vt${tokens.length}:${verdict.grew ? "new" : "repl"}`
          );
          if (elapsed - lastAttributionMs < VIDEO_TILE_RECOVERY_STEP_MS) continue;
          lastAttributionMs = elapsed;
          let matched;
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
              submitTrace.push(`v${index}:mismatch:${opened.editorPrompt.slice(0, 24)}`);
              continue;
            }
            matched = opened;
            break;
          }
          if (!matched && everyCandidateDisproved) {
            throw bridgeError(
              "MEDIA_FAILED",
              `New video tile(s) appeared on Flow but none had an editor prompt matching this node, so the pipeline cannot claim them. Trace ${submitTrace.slice(-6).join(" | ")}`,
              true
            );
          }
          if (!matched) {
            continue;
          }
          const previewUrl2 = await resolveRedirectSafe(matched.mediaId, "VIDEO");
          return { mediaId: matched.mediaId, type: "VIDEO", projectId: payload.projectId, previewUrl: previewUrl2, completedViaUi: true };
        }
        throw bridgeError(
          "TIMEOUT",
          `Timed out waiting for generated media to appear on Flow page via CDP. Trace ${submitTrace.join(" | ")} | ${await composerDiag()}`,
          true
        );
      } finally {
        try {
          await chrome.debugger.detach(target);
        } catch {
        }
      }
    }
    const reply = await timeoutable(
      chrome.tabs.sendMessage(tabId, {
        type: "FLOWGRAPH_UI_GENERATE",
        prompt,
        kind: payload.kind,
        startImageMediaId: payload.startImage?.mediaId
      }),
      // The content script runs its own submit + media wait, so this has to cover
      // the longest legitimate render rather than the old flat 180s.
      MEDIA_WAIT_VIDEO_MS
    );
    if (!reply?.ok || !reply.mediaId) {
      const why = attached ? "" : ` [CDP unavailable${attachFailure ? `: ${attachFailure}` : ""}; used content-script fallback]`;
      throw bridgeError(
        reply?.code ?? "MEDIA_FAILED",
        `${reply?.message ?? "UI generation failed via content script"}${why}`,
        true
      );
    }
    const previewUrl = await resolveRedirectSafe(reply.mediaId);
    return {
      mediaId: reply.mediaId,
      type: reply.type ?? (isVideoKind(payload.kind) ? "VIDEO" : "IMAGE"),
      projectId: payload.projectId,
      previewUrl
    };
  }
  async function handleMediaStatus(payload) {
    try {
      const previewUrl = await resolveMediaUrl(payload.mediaId, "IMAGE");
      if (previewUrl) {
        return {
          status: "SUCCESSFUL",
          media: {
            mediaId: payload.mediaId,
            type: "IMAGE",
            projectId: payload.projectId,
            previewUrl
          }
        };
      }
    } catch {
    }
    try {
      const previewUrl = await resolveMediaUrl(payload.mediaId, "VIDEO");
      if (previewUrl) {
        return {
          status: "SUCCESSFUL",
          media: {
            mediaId: payload.mediaId,
            type: "VIDEO",
            projectId: payload.projectId,
            previewUrl
          }
        };
      }
    } catch {
    }
    return pollOnce(payload, true);
  }
  async function handleMediaUpload(payload) {
    const json = await aisandboxFetch("flow/uploadImage", buildUploadRequest(
      payload.projectId,
      payload.imageBytesBase64,
      payload.mimeType,
      payload.fileName
    ));
    const media = json.media?.[0];
    if (!media?.name) throw bridgeError("MEDIA_FAILED", "Upload returned no media id", false);
    return {
      mediaId: media.name,
      type: "IMAGE",
      projectId: media.projectId ?? payload.projectId,
      workflowId: media.workflowId,
      mimeType: payload.mimeType,
      fileName: payload.fileName
    };
  }
  async function handleCancel(payload) {
    return aisandboxFetch("flowMedia:cancelGeneration", buildCancelRequest(payload.mediaId));
  }
  async function handleRequest(request) {
    try {
      switch (request.type) {
        case "FLOWGRAPH_ACCOUNT_STATUS":
          return makeResponse(request.requestId, await handleAccountStatus());
        case "FLOWGRAPH_FLOW_STATUS":
          return makeResponse(request.requestId, await pingFlowTab());
        case "FLOWGRAPH_CREDITS":
          return makeResponse(request.requestId, await handleCredits());
        case "FLOWGRAPH_PROJECT_LIST": {
          const data = await handleProjectList();
          return makeResponse(request.requestId, data);
        }
        case "FLOWGRAPH_PROJECT_CREATE": {
          const payload = request.payload;
          if (!payload?.projectTitle?.trim()) throw bridgeError("INVALID_INPUT", "Project name is required", false);
          return makeResponse(request.requestId, await handleProjectCreate(payload.projectTitle.trim()));
        }
        case "FLOWGRAPH_PROJECT_SELECT": {
          const payload = request.payload;
          if (!payload?.projectId) throw bridgeError("INVALID_INPUT", "projectId is required", false);
          activeProjectId = payload.projectId;
          try {
            const tab = await findFlowTab();
            const targetUrl = `https://flow.google.com/project/${payload.projectId}`;
            if (tab && tab.id !== void 0) {
              await chrome.tabs.update(tab.id, { url: targetUrl });
            } else {
              await chrome.tabs.create({ url: targetUrl, active: false });
            }
          } catch (e) {
            console.warn("Could not navigate Flow tab to project:", e);
          }
          return makeResponse(request.requestId, { projectId: payload.projectId, selectedAt: (/* @__PURE__ */ new Date()).toISOString() });
        }
        case "FLOWGRAPH_MEDIA_UPLOAD":
          return makeResponse(request.requestId, await handleMediaUpload(request.payload));
        case "FLOWGRAPH_GENERATE": {
          const genPayload = request.payload;
          const isDirectApiPath = genPayload.kind === "upscale" || genPayload.kind === "imageUpscale" || genPayload.kind === "videoUpscale";
          if (isDirectApiPath) {
            return makeResponse(request.requestId, await generateApi(genPayload));
          }
          return makeResponse(request.requestId, await handleGenerate(genPayload));
        }
        case "FLOWGRAPH_MEDIA_STATUS":
          return makeResponse(request.requestId, await handleMediaStatus(request.payload));
        case "FLOWGRAPH_MEDIA_DOWNLOAD":
          return makeResponse(request.requestId, await downloadMedia(request.payload));
        case "FLOWGRAPH_CANCEL":
          return makeResponse(request.requestId, await handleCancel(request.payload));
        case "FLOWGRAPH_SYNC_SET_BATCH":
        case "FLOWGRAPH_SYNC_SET_BATCH_COUNT":
          return makeResponse(request.requestId, await forwardSyncWrite(request));
        default:
          return makeError(request.requestId, "UNSUPPORTED_MESSAGE", `Unsupported message type: ${request.type}`);
      }
    } catch (error) {
      const normalized = normalizeError(error);
      return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
    }
  }
  var SYNC_WRITE_TYPES = /* @__PURE__ */ new Set([
    "FLOWGRAPH_SYNC_SET_PROMPT",
    "FLOWGRAPH_SYNC_SET_MODE",
    "FLOWGRAPH_SYNC_SET_MODEL",
    "FLOWGRAPH_SYNC_SET_ASPECT_RATIO",
    "FLOWGRAPH_SYNC_SET_BATCH",
    "FLOWGRAPH_SYNC_SET_BATCH_COUNT",
    "FLOWGRAPH_SYNC_SET_DURATION",
    "FLOWGRAPH_SYNC_SET_SEED",
    "FLOWGRAPH_SYNC_SET_RESOLUTION",
    "FLOWGRAPH_SYNC_BIND_MEDIA",
    "FLOWGRAPH_SYNC_START_FRAME",
    "FLOWGRAPH_SYNC_END_FRAME",
    "FLOWGRAPH_SYNC_REFERENCE_MEDIA",
    "FLOWGRAPH_SYNC_GENERATE",
    "FLOWGRAPH_SYNC_CANCEL"
  ]);
  var SYNC_RELAY_TYPES = /* @__PURE__ */ new Set(["FLOWGRAPH_SYNC_EVENT", "FLOWGRAPH_SYNC_STATE"]);
  var SYNC_FOREGROUND_TYPES = /* @__PURE__ */ new Set([]);
  function isSyncRelayMessage(message) {
    const type = message?.type;
    return typeof type === "string" && (SYNC_WRITE_TYPES.has(type) || SYNC_RELAY_TYPES.has(type));
  }
  async function clearRealtimeFrameBindings(tab, fields) {
    if (tab.id === void 0 || fields.length === 0) return;
    const expectedProjectId = projectIdFromUrl(tab.url ?? "");
    if (!expectedProjectId) {
      throw bridgeError("PROJECT_MISMATCH", "Cannot clear frame bindings outside an exact Flow project.", false);
    }
    const target = { tabId: tab.id };
    let attached = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await ensureInputReachable(target);
      const inspectField = async (field) => {
        const response = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
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
              .some((button) => /Video \xB7/.test(button.innerText || '')
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
          returnByValue: true
        });
        return response.result?.value;
      };
      for (const field of [...fields].reverse()) {
        const readyDeadline = Date.now() + 4e3;
        let before;
        do {
          before = await inspectField(field);
          if (!before?.onProject) {
            throw bridgeError("PROJECT_MISMATCH", "Flow navigated away from the expected project.", false);
          }
          if (before.uiReady) break;
          await new Promise((resolve) => setTimeout(resolve, 150));
        } while (Date.now() < readyDeadline);
        if (!before?.uiReady) {
          throw bridgeError("UI_NOT_READY", "Flow frame controls did not become ready after mode switch.", true);
        }
        if (!before.hasMedia) continue;
        if (!before.clickable) {
          throw bridgeError("UI_NOT_READY", `Flow ${field} control is not clickable.`, true);
        }
        const activation = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
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
          returnByValue: true
        });
        if (!activation.result?.value?.ok) {
          throw bridgeError(
            activation.result?.value?.reason === "project-mismatch" ? "PROJECT_MISMATCH" : "UI_NOT_READY",
            `Could not activate Flow ${field} control (${activation.result?.value?.reason ?? "unknown"}).`,
            true
          );
        }
        const deadline = Date.now() + 3e3;
        let after;
        let cleared = false;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          after = await inspectField(field);
          if (!after?.onProject) {
            throw bridgeError("PROJECT_MISMATCH", "Flow navigated away while clearing frame media.", false);
          }
          if (after.uiReady && !after.hasMedia) {
            cleared = true;
            break;
          }
        }
        if (!cleared) {
          throw bridgeError("PREFLIGHT_FAILED", `Could not clear stale Flow frame binding: ${field}.`, true);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const verification = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
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
            .some((button) => /Video \xB7/.test(button.innerText || '')
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
        returnByValue: true
      });
      if (!verification.result?.value?.onProject) {
        throw bridgeError("PROJECT_MISMATCH", "Flow navigated away from the expected project.", false);
      }
      if (!verification.result?.value?.uiReady) {
        throw bridgeError("UI_NOT_READY", "Flow frame controls are not ready after clearing media.", true);
      }
      const remaining = verification.result.value.remaining ?? [];
      if (remaining.length > 0) {
        throw bridgeError("PREFLIGHT_FAILED", `Could not clear stale Flow frame bindings: ${remaining.join(", ")}.`, true);
      }
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function ensureDesktopViewport(tab) {
    return;
  }
  async function bindRealtimeStartImage(tab, mediaId) {
    if (tab.id === void 0 || !mediaId) {
      throw bridgeError("INVALID_VALUE", "Start Frame requires an exact mediaId.", false);
    }
    await ensureDesktopViewport(tab);
    await timeoutable(chrome.tabs.sendMessage(tab.id, {
      type: "FLOWGRAPH_SYNC_SUPPRESS_ECHO",
      field: "startImage",
      value: { mediaId }
    }), 2e3).catch(() => void 0);
    const target = { tabId: tab.id };
    let attached = false;
    const evaluate = async (expression) => {
      const response = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (response.exceptionDetails) throw bridgeError("UI_NOT_READY", response.exceptionDetails.text ?? "Flow DOM evaluation failed.", true);
      return response.result?.value;
    };
    const clickAt = async (x, y) => {
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      await new Promise((resolve) => setTimeout(resolve, 70));
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1
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
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await ensureInputReachable(target);
      if (await evaluate(boundExpression)) return { ok: true, mediaId };
      const tile = await evaluate(`((mediaId) => {
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
      if (!tile.ok || tile.x === void 0 || tile.y === void 0) {
        throw bridgeError("MEDIA_FAILED", `Exact source media ${mediaId} was not found in Flow (${tile.reason ?? "unknown"}).`, true);
      }
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: tile.x, y: tile.y });
      await new Promise((resolve) => setTimeout(resolve, 450));
      const more = await evaluate(`((mediaId) => {
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
      if (!more.ok || more.x === void 0 || more.y === void 0) {
        throw bridgeError("MEDIA_FAILED", `Exact source media ${mediaId} menu was not available (${more.reason ?? "unknown"}).`, true);
      }
      await clickAt(more.x, more.y);
      await new Promise((resolve) => setTimeout(resolve, 550));
      const animate = await evaluate(`(() => {
      const scopes = [...document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content], .cdk-overlay-pane')];
      const item = scopes.flatMap((menu) => [...menu.querySelectorAll('[role="menuitem"], [role="option"], button')])
        .find((candidate) => (candidate.textContent || '').includes('motion_blur') || /T\u1EA1o \u1EA3nh \u0111\u1ED9ng|Animate/i.test(candidate.innerText || ''));
      if (!item) return { ok: false };
      const rect = item.getBoundingClientRect();
      return rect.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false };
    })()`);
      if (!animate.ok || animate.x === void 0 || animate.y === void 0) {
        throw bridgeError("MEDIA_FAILED", `Flow Animate action was not found for ${mediaId}.`, true);
      }
      await clickAt(animate.x, animate.y);
      for (let check = 0; check < 10; check += 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (await evaluate(boundExpression)) return { ok: true, mediaId };
      }
      if (!await evaluate(boundExpression)) {
        throw bridgeError("MEDIA_FAILED", `Flow did not bind ${mediaId} as the composer Start Frame.`, true);
      }
      return { ok: true, mediaId };
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function bindRealtimeEndImage(tab, mediaId) {
    if (tab.id === void 0 || !mediaId) {
      throw bridgeError("INVALID_VALUE", "End Frame requires an exact mediaId.", false);
    }
    await ensureDesktopViewport(tab);
    await timeoutable(chrome.tabs.sendMessage(tab.id, {
      type: "FLOWGRAPH_SYNC_SUPPRESS_ECHO",
      field: "endImage",
      value: { mediaId }
    }), 2e3).catch(() => void 0);
    const target = { tabId: tab.id };
    let attached = false;
    const evaluate = async (expression) => {
      const response = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (response.exceptionDetails) {
        throw bridgeError("UI_NOT_READY", response.exceptionDetails.text ?? "Flow DOM evaluation failed.", true);
      }
      return response.result?.value;
    };
    const clickAt = async (x, y) => {
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      await new Promise((resolve) => setTimeout(resolve, 70));
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1
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
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await ensureInputReachable(target);
      if (await evaluate(endBoundExpression)) return { ok: true, mediaId };
      const endSlot = await evaluate(`(() => {
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
      if (!endSlot.ok || endSlot.x === void 0 || endSlot.y === void 0) {
        throw bridgeError("UI_NOT_READY", `Flow End Frame slot was not available (${endSlot.reason ?? "unknown"}).`, true);
      }
      await clickAt(endSlot.x, endSlot.y);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const dialogOpened = await evaluate(`[...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
      .some((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0)`);
      if (!dialogOpened) {
        const opened = await evaluate(`(() => {
        const element = [...document.querySelectorAll('[type="button"][aria-haspopup="dialog"], .frame-trigger, button, div')]
          .find((candidate) => /^(K\u1EBFt th\xFAc|End)$/i.test((candidate.textContent || '').trim())
            || candidate.classList.contains('frame-trigger'));
        element?.click();
        return Boolean(element);
      })()`);
        if (!opened) throw bridgeError("UI_NOT_READY", "Flow End Frame dialog trigger disappeared.", true);
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      const readDialogMedia = () => evaluate(`((mediaId) => {
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
      if (!media.ok || media.x === void 0 || media.y === void 0) {
        throw bridgeError("MEDIA_FAILED", `Exact End Frame media ${mediaId} was not found (${media.reason ?? "unknown"}).`, true);
      }
      await clickAt(media.x, media.y);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const readAddButton = () => evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
        .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
      const button = [...(dialog?.querySelectorAll('button') || [])]
        .find((candidate) => /Th\xEAm v\xE0o c\xE2u l\u1EC7nh|Add to prompt|X\xE1c nh\u1EADn|Confirm|Ch\u1ECDn|Select/i.test(candidate.innerText || ''));
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
      if (!add.ok || add.x === void 0 || add.y === void 0) {
        throw bridgeError("UI_NOT_READY", `Flow End Frame picker could not commit (${add.reason ?? "unknown"}).`, true);
      }
      await clickAt(add.x, add.y);
      for (let check = 0; check < 10; check += 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (await evaluate(endBoundExpression)) return { ok: true, mediaId };
      }
      if (!await evaluate(endBoundExpression)) {
        throw bridgeError("MEDIA_FAILED", `Flow did not bind ${mediaId} as the End Frame.`, true);
      }
      return { ok: true, mediaId };
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function bindRealtimeVideoInput(tab, mediaId, mode) {
    if (tab.id === void 0 || !mediaId) {
      throw bridgeError("INVALID_VALUE", "Extend/Edit Video requires an exact mediaId.", false);
    }
    const projectUrl = (tab.url ?? "").replace(/\/edit\/[0-9a-zA-Z_-]+.*$/, "");
    await ensureDesktopViewport(tab);
    const target = { tabId: tab.id };
    let attached = false;
    const evaluate = async (expression) => {
      const response = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (response.exceptionDetails) throw bridgeError("UI_NOT_READY", response.exceptionDetails.text ?? "Flow DOM evaluation failed.", true);
      return response.result?.value;
    };
    const clickAt = async (x, y) => {
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      await new Promise((resolve) => setTimeout(resolve, 70));
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1
      });
    };
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await ensureInputReachable(target);
      const editUrl = `${projectUrl}/edit/${mediaId}`;
      await chrome.debugger.sendCommand(target, "Page.navigate", { url: editUrl }).catch(() => {
      });
      await new Promise((resolve) => setTimeout(resolve, 3e3));
      const editSetup = await evaluate(`((mode) => {
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
      if (editSetup.ok && editSetup.x !== void 0 && editSetup.y !== void 0) {
        await clickAt(editSetup.x, editSetup.y);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      const hereUrl = await evaluate("location.href");
      if (!hereUrl || !hereUrl.includes(`/edit/${mediaId}`)) {
        throw bridgeError("MEDIA_FAILED", `Flow did not navigate to editor for video ${mediaId} (current: ${hereUrl}).`, true);
      }
      return { ok: true, mediaId };
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function bindRealtimeReferenceMedia(tab, values) {
    if (tab.id === void 0) {
      throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    }
    const expectedProjectId = projectIdFromUrl(tab.url ?? "");
    const mediaIds = [...new Set(values.map((value) => value.mediaId.trim()).filter(Boolean))];
    if (!expectedProjectId) {
      throw bridgeError("PROJECT_MISMATCH", "Reference Media requires an exact Flow project.", false);
    }
    if (mediaIds.length === 0) {
      throw bridgeError("INVALID_VALUE", "Reference Media requires at least one exact mediaId.", false);
    }
    await timeoutable(chrome.tabs.sendMessage(tab.id, {
      type: "FLOWGRAPH_SYNC_SUPPRESS_ECHO",
      field: "referenceMedia",
      value: mediaIds.map((mediaId) => ({ mediaId }))
    }), 2e3).catch(() => void 0);
    const target = { tabId: tab.id };
    let attached = false;
    const evaluate = async (expression) => {
      const response = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (response.exceptionDetails) {
        throw bridgeError("UI_NOT_READY", response.exceptionDetails.text ?? "Flow DOM evaluation failed.", true);
      }
      return response.result?.value;
    };
    const clickAt = async (point) => {
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x,
        y: point.y
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: point.x,
        y: point.y,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      await new Promise((resolve) => setTimeout(resolve, 70));
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: point.x,
        y: point.y,
        button: "left",
        buttons: 0,
        clickCount: 1
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
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await ensureInputReachable(target);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const removed = await evaluate(`((projectId) => {
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
          throw bridgeError("PROJECT_MISMATCH", "Flow navigated away while clearing Reference Media.", false);
        }
        if (!removed.removed) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if ((await evaluate(referenceIdsExpression)).length > 0) {
        throw bridgeError("PREFLIGHT_FAILED", "Could not clear existing Flow Reference Media.", true);
      }
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27
      }).catch(() => void 0);
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27
      }).catch(() => void 0);
      const chip = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
        .find((candidate) => /Video \xB7/.test(candidate.innerText || ''));
      const rect = button?.getBoundingClientRect();
      return button && rect?.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false };
    })()`);
      if (!chip.ok || chip.x === void 0 || chip.y === void 0) {
        throw bridgeError("UI_NOT_READY", "Flow Video settings chip was not available for Reference Media.", true);
      }
      await clickAt({ x: chip.x, y: chip.y });
      await new Promise((resolve) => setTimeout(resolve, 400));
      const componentTab = await evaluate(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((candidate) => /Th\xE0nh ph\u1EA7n|Components?/i.test(candidate.innerText || ''));
      const rect = tab?.getBoundingClientRect();
      return tab && rect?.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false };
    })()`);
      if (!componentTab.ok || componentTab.x === void 0 || componentTab.y === void 0) {
        throw bridgeError("NO_UI_COUNTERPART", "Google Flow does not expose a Components reference tab.", false);
      }
      await clickAt({ x: componentTab.x, y: componentTab.y });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const componentSelected = await evaluate(`(() => [...document.querySelectorAll('[role="tab"]')]
      .some((candidate) => /Th\xE0nh ph\u1EA7n|Components?/i.test(candidate.innerText || '')
        && candidate.getAttribute('aria-selected') === 'true'))()`);
      if (!componentSelected) {
        throw bridgeError("UI_NOT_READY", "Flow Components reference tab did not commit.", true);
      }
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27
      }).catch(() => void 0);
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27
      }).catch(() => void 0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      for (const mediaId of mediaIds) {
        const addTrigger = await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((candidate) =>
          [...candidate.querySelectorAll('i.google-symbols, .google-symbols')]
            .some((icon) => (icon.textContent || '').trim() === 'add_2'));
        const rect = button?.getBoundingClientRect();
        return button && rect?.width && rect.height
          ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { ok: false };
      })()`);
        if (!addTrigger.ok || addTrigger.x === void 0 || addTrigger.y === void 0) {
          throw bridgeError("UI_NOT_READY", "Flow Reference Media picker trigger was not available.", true);
        }
        await clickAt({ x: addTrigger.x, y: addTrigger.y });
        await new Promise((resolve) => setTimeout(resolve, 350));
        const option = await evaluate(`((mediaId) => {
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
        if (!option.ok || option.x === void 0 || option.y === void 0) {
          throw bridgeError("MEDIA_FAILED", `Exact Reference Media ${mediaId} was not found in the Flow picker.`, true);
        }
        if (!option.selected) {
          await clickAt({ x: option.x, y: option.y });
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const addButton = await evaluate(`(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"]')]
          .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
        const button = [...(dialog?.querySelectorAll('button') || [])]
          .find((candidate) => /Th\xEAm v\xE0o c\xE2u l\u1EC7nh|Add to prompt/i.test(candidate.innerText || ''));
        if (!button) return { ok: false, reason: 'add-button-not-found' };
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
          return { ok: false, reason: 'add-button-disabled' };
        }
        const rect = button.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
        if (!addButton.ok || addButton.x === void 0 || addButton.y === void 0) {
          throw bridgeError("UI_NOT_READY", `Flow could not commit Reference Media ${mediaId} (${addButton.reason ?? "unknown"}).`, true);
        }
        await clickAt({ x: addButton.x, y: addButton.y });
        await new Promise((resolve) => setTimeout(resolve, 550));
        const applied2 = await evaluate(referenceIdsExpression);
        if (!applied2.includes(mediaId)) {
          throw bridgeError("MEDIA_FAILED", `Flow did not bind exact Reference Media ${mediaId}.`, true);
        }
      }
      const applied = await evaluate(referenceIdsExpression);
      if (JSON.stringify(applied) !== JSON.stringify(mediaIds)) {
        throw bridgeError(
          "MEDIA_FAILED",
          `Flow Reference Media order mismatch (requested ${mediaIds.join(", ")}, applied ${applied.join(", ")}).`,
          true
        );
      }
      return { ok: true, mediaIds: applied };
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function forwardSyncWrite(request) {
    const tab = await findFlowTab();
    if (!tab?.id) return makeError(request.requestId, "NO_FLOW_TAB", "No Google Flow tab is open.", false);
    await ensureFlowContentScript(tab.id);
    const payload = request.payload ?? {};
    const requestedProjectId = typeof payload.projectId === "string" ? payload.projectId : void 0;
    const tabProjectId = projectIdFromUrl(tab.url ?? "");
    if (!requestedProjectId) {
      return makeError(request.requestId, "PROJECT_REQUIRED", "Realtime sync requires an explicit projectId.", false);
    }
    if (!tabProjectId || tabProjectId !== requestedProjectId) {
      return makeError(
        request.requestId,
        "PROJECT_MISMATCH",
        `Flow tab project ${tabProjectId ?? "none"} does not match sync project ${requestedProjectId}.`,
        false
      );
    }
    if (SYNC_FOREGROUND_TYPES.has(request.type) && !tab.active) {
    }
    if (request.type === "FLOWGRAPH_SYNC_START_FRAME") {
      const mediaId = typeof payload.value?.mediaId === "string" ? String(payload.value.mediaId) : "";
      try {
        return makeResponse(request.requestId, await bindRealtimeStartImage(tab, mediaId));
      } catch (error) {
        const normalized = normalizeError(error);
        return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
      }
    }
    if (request.type === "FLOWGRAPH_SYNC_END_FRAME") {
      const mediaId = typeof payload.value?.mediaId === "string" ? String(payload.value.mediaId) : "";
      try {
        return makeResponse(request.requestId, await bindRealtimeEndImage(tab, mediaId));
      } catch (error) {
        const normalized = normalizeError(error);
        return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
      }
    }
    if (request.type === "FLOWGRAPH_SYNC_REFERENCE_MEDIA") {
      const values = Array.isArray(payload.value) ? payload.value.filter((value) => typeof value === "object" && value !== null && typeof value.mediaId === "string") : [];
      try {
        return makeResponse(request.requestId, await bindRealtimeReferenceMedia(tab, values));
      } catch (error) {
        const normalized = normalizeError(error);
        return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
      }
    }
    if (request.type === "FLOWGRAPH_SYNC_BIND_MEDIA") {
      return makeError(
        request.requestId,
        "NO_UI_COUNTERPART",
        `${request.type} has no verified standalone Google Flow UI adapter yet.`,
        false
      );
    }
    const forwarded = {
      ...request,
      requestId: `sw:${request.requestId ?? crypto.randomUUID()}`,
      payload: { ...payload, tabId: tab.id }
    };
    const reply = await timeoutable(
      chrome.tabs.sendMessage(tab.id, forwarded),
      SYNC_WRITE_TIMEOUT_MS
    ).catch((err) => {
      return { ok: false, code: "SYNC_TIMEOUT", message: err?.message || "Sync write timed out." };
    });
    return reply?.ok ? makeResponse(request.requestId, reply) : makeResponse(request.requestId, { ok: false, code: reply?.code ?? "UI_NOT_READY", message: reply?.message ?? "Sync write not ready" });
  }
  chrome.runtime.onInstalled.addListener(() => {
    console.info("FlowGraph Extension installed");
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isSyncRelayMessage(message)) {
      const request2 = message;
      if (SYNC_WRITE_TYPES.has(request2.type)) {
        void forwardSyncWrite(request2).then(sendResponse);
        return true;
      }
      const notification = message;
      void chrome.runtime.sendMessage({ type: request2.type, requestId: `sw:sync:${request2.requestId ?? "notification"}`, payload: notification.payload }).catch(() => {
      });
      return false;
    }
    const request = message;
    if (request?.type?.startsWith("FLOWGRAPH_")) {
      void handleRequest(request).then(sendResponse);
      return true;
    }
    return false;
  });
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (!changeInfo.url && changeInfo.status !== "complete") return;
    const url = tab?.url ?? changeInfo.url;
    if (!isFlowUrl(url ?? "")) return;
    void (async () => {
      try {
        const flow = await pingFlowTab();
        if (flow.state !== "READY" && flow.state !== "PROJECT_REQUIRED") return;
        await chrome.runtime.sendMessage({
          type: "FLOWGRAPH_EVENT",
          requestId: "sw:flow:changed",
          payload: { flow }
        }).catch(() => {
        });
      } catch {
      }
    })();
  });
})();

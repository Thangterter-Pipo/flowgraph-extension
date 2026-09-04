(() => {
  // src/shared/flowPayloads.ts
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

  // src/background/service-worker.ts
  var AISANDBOX_BASE = "https://aisandbox-pa.googleapis.com/v1";
  var FX_API_BASE = "https://labs.google/fx/api";
  var TOKEN_TTL_MS = 50 * 60 * 1e3;
  var REQUEST_TIMEOUT_MS = 6e4;
  var SYNC_WRITE_TIMEOUT_MS = 12e3;
  var DOWNLOAD_TIMEOUT_MS = 18e4;
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
    return candidates.sort(
      (a, b) => score(b) - score(a) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)
    )[0] ?? null;
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
      return resolveVideoUrlViaDebugger(tab.id, tab.url, mediaId);
    }
    try {
      if (tab.windowId !== void 0) await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
    } catch {
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
            if (isAsb(s)) return { ok: true, url: s };
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
  async function resolveVideoUrlViaDebugger(tabId, galleryUrl, mediaId) {
    const target = { tabId };
    let attachedHere = false;
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
      await chrome.debugger.sendCommand(target, "Page.bringToFront").catch(() => {
      });
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
      const findVideo = () => evalOnPage(
        `(()=>{const v=Array.from(document.querySelectorAll('video')).find((el)=>((el.currentSrc||el.src||'').includes(${JSON.stringify(mediaId)})));return v?(v.currentSrc||v.src||''):''})()`
      );
      const already = await findVideo();
      if (already) return already;
      const tileCount = await evalOnPage(`document.querySelectorAll('flow-video-tile').length`) ?? 0;
      for (let i = 0; i < Math.min(tileCount, 24); i += 1) {
        const pos = await evalOnPage(
          `(()=>{const t=document.querySelectorAll('flow-video-tile')[${i}];if(!t)return null;const b=t.getBoundingClientRect();if(b.width<10)return null;return{x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`
        );
        if (!pos) continue;
        await clickAt(pos.x, pos.y);
        let url = "";
        for (let k = 0; k < 12; k += 1) {
          await new Promise((r) => setTimeout(r, 400));
          url = await findVideo() ?? "";
          if (url) break;
        }
        if (url) return url;
        if (galleryUrl) {
          await chrome.debugger.sendCommand(target, "Page.navigate", { url: galleryUrl }).catch(() => {
          });
          await new Promise((r) => setTimeout(r, 4e3));
        }
      }
      throw bridgeError("MEDIA_FAILED", "Could not resolve a signed video URL for this media on the Flow page.", false);
    } finally {
      if (attachedHere) {
        try {
          await chrome.debugger.detach(target);
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
      new Promise((resolve) => {
        chrome.downloads.download({
          url,
          filename,
          saveAs: false,
          conflictAction: "uniquify"
        }).then((downloadId) => {
          const listener = (delta) => {
            if (delta.id !== downloadId || !delta.state?.current) return;
            if (delta.state.current !== "complete" && delta.state.current !== "interrupted") return;
            chrome.downloads.onChanged.removeListener(listener);
            if (delta.state.current === "interrupted") {
              resolve({ ok: false, downloadId, error: delta.error?.current ?? "Download interrupted" });
              return;
            }
            void chrome.downloads.search({ id: downloadId }).then(([item]) => resolve({ ok: true, downloadId, filename: item?.filename }));
          };
          chrome.downloads.onChanged.addListener(listener);
        }).catch((error) => resolve({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }),
      DOWNLOAD_TIMEOUT_MS
    );
  }
  async function handleAccountStatus() {
    try {
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
    if (payload.targetResolution) {
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
    await applyWrites(settingWrites);
    if (promptWrite) await applyWrites([promptWrite]);
    return { limitations };
  }
  async function handleGenerate(payload) {
    const tab = await findFlowTab();
    if (!tab || tab.id === void 0) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const tabId = tab.id;
    const prompt = payload.prompt ?? "A cinematic red paper boat floating on a calm lake at sunrise, 16:9";
    const galleryUrl = (tab.url ?? "").replace(/\/edit\/[0-9a-zA-Z_-]+.*$/, "");
    const target = { tabId };
    let attached = false;
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch {
    }
    await syncAndVerifyBeforeGenerate(tab, { ...payload, prompt });
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await chrome.debugger.sendCommand(target, "Page.bringToFront").catch(() => {
      });
    } catch {
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
        const modeResult = await evalOnPage(`
        (async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const isChip = (b) => {
            const t = (b.innerText || '').replace(/\\s+/g, ' ');
            const isTrigger = b.getAttribute('aria-haspopup') === 'menu'
              || b.classList.contains('settings-trigger-button');
            return isTrigger && (t.includes('Video \xB7') || t.includes('Nano Banana'));
          };
          const readChip = () => {
            const chip = Array.from(document.querySelectorAll('button')).find(isChip);
            if (!chip) return null;
            const t = (chip.innerText || '').replace(/\\s+/g, ' ').trim();
            return { isVideo: t.includes('Video \xB7'), text: t };
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
            return ${wantVideo} ? txt.includes('video') : (txt.includes('h\xECnh \u1EA3nh') || txt.includes('image'));
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
            "MEDIA_FAILED",
            `Could not switch Flow composer to ${wantVideo ? "Video" : "Image"} mode (${modeResult?.reason ?? "unknown"}).`,
            true
          );
        }
        return modeResult.text ?? "";
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
      const readVideoPosterTokens = () => evalOnPage(`
      (() => {
        const toks = [];
        document.querySelectorAll('flow-video-tile img').forEach((el) => {
          const s = el.currentSrc || el.src || '';
          const m = s.match(/\\/asb\\/([A-Za-z0-9_-]+)/);
          if (m && m[1]) toks.push(m[1]);
        });
        return toks;
      })()
    `);
      const openVideoTileAndGetId = async (token) => {
        const pos = await evalOnPage(`((tok) => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        for (const t of tiles) {
          const img = t.querySelector('img');
          const s = img ? (img.currentSrc || img.src || '') : '';
          if (s.includes('/asb/' + tok)) {
            t.scrollIntoView?.({ block: 'center', inline: 'center' });
            const b = t.getBoundingClientRect();
            if (b.width < 10 || b.height < 10) return null;
            return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
          }
        }
        return null;
      })(${JSON.stringify(token)})`);
        if (!pos) return "";
        await clickAt(pos.x, pos.y);
        for (let k = 0; k < 15; k += 1) {
          await new Promise((r) => setTimeout(r, 400));
          const href = await evalOnPage(`location.href`);
          const m = href && href.match(/\/edit\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
          if (m && m[1]) {
            await chrome.debugger.sendCommand(target, "Page.navigate", { url: galleryUrl }).catch(() => {
            });
            await new Promise((r) => setTimeout(r, 3e3));
            return m[1];
          }
        }
        await chrome.debugger.sendCommand(target, "Page.navigate", { url: galleryUrl }).catch(() => {
        });
        await new Promise((r) => setTimeout(r, 3e3));
        return "";
      };
      try {
        const beforeIds = await readMediaIds() ?? [];
        const beforeVidTokens = new Set(await readVideoPosterTokens() ?? []);
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
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: generateButton.x,
          y: generateButton.y
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: generateButton.x,
          y: generateButton.y,
          button: "left",
          buttons: 1,
          clickCount: 1
        });
        await new Promise((resolve) => setTimeout(resolve, 80));
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: generateButton.x,
          y: generateButton.y,
          button: "left",
          buttons: 0,
          clickCount: 1
        });
        const maxWaitMs = 18e4;
        const startMs = Date.now();
        const initialSet = new Set(beforeIds);
        const wantVideo = isVideoKind(payload.kind);
        const captchaGraceMs = 25e3;
        const detectInteractiveCaptcha = () => evalOnPage(
          `(()=>{for(const f of document.querySelectorAll('iframe')){if(!/recaptcha/i.test(f.src||''))continue;const r=f.getBoundingClientRect();if(r.width<120||r.height<40)continue;const cx=r.x+r.width/2,cy=r.y+r.height/2;if(cx<0||cy<0||cx>=innerWidth||cy>=innerHeight)continue;let el=f,vis=true;while(el){const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0){vis=false;break}el=el.parentElement}if(!vis)continue;const hit=document.elementFromPoint(cx,cy);if(hit&&(hit===f||f.contains(hit)))return true}return false})()`
        );
        while (Date.now() - startMs < maxWaitMs) {
          await new Promise((r) => setTimeout(r, 4e3));
          const elapsed = Date.now() - startMs;
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
          const newToken = tokens.find((t) => !beforeVidTokens.has(t));
          if (!newToken) {
            if (elapsed >= captchaGraceMs && await detectInteractiveCaptcha()) {
              throw bridgeError(
                "CAPTCHA_REQUIRED",
                "Google Flow presented an interactive reCAPTCHA challenge for this generation. Solve it in the Flow tab, then run the workflow again.",
                true
              );
            }
            continue;
          }
          const videoId = await openVideoTileAndGetId(newToken);
          if (!videoId) continue;
          const previewUrl2 = await resolveRedirectSafe(videoId, "VIDEO");
          return { mediaId: videoId, type: "VIDEO", projectId: payload.projectId, previewUrl: previewUrl2, completedViaUi: true };
        }
        throw bridgeError("TIMEOUT", "Timed out waiting for generated media to appear on Flow page via CDP.", true);
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
      18e4
    );
    if (!reply?.ok || !reply.mediaId) {
      throw bridgeError(reply?.code ?? "MEDIA_FAILED", reply?.message ?? "UI generation failed via content script", true);
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
          return makeResponse(request.requestId, { projectId: payload.projectId, selectedAt: (/* @__PURE__ */ new Date()).toISOString() });
        }
        case "FLOWGRAPH_MEDIA_UPLOAD":
          return makeResponse(request.requestId, await handleMediaUpload(request.payload));
        case "FLOWGRAPH_GENERATE":
          return makeResponse(request.requestId, await handleGenerate(request.payload));
        case "FLOWGRAPH_MEDIA_STATUS":
          return makeResponse(request.requestId, await handleMediaStatus(request.payload));
        case "FLOWGRAPH_MEDIA_DOWNLOAD":
          return makeResponse(request.requestId, await downloadMedia(request.payload));
        case "FLOWGRAPH_CANCEL":
          return makeResponse(request.requestId, await handleCancel(request.payload));
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
  var SYNC_FOREGROUND_TYPES = /* @__PURE__ */ new Set([
    "FLOWGRAPH_SYNC_SET_MODE",
    "FLOWGRAPH_SYNC_SET_MODEL",
    "FLOWGRAPH_SYNC_SET_ASPECT_RATIO",
    "FLOWGRAPH_SYNC_SET_DURATION",
    "FLOWGRAPH_SYNC_SET_RESOLUTION",
    "FLOWGRAPH_SYNC_BIND_MEDIA",
    "FLOWGRAPH_SYNC_START_FRAME",
    "FLOWGRAPH_SYNC_END_FRAME",
    "FLOWGRAPH_SYNC_REFERENCE_MEDIA"
  ]);
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
    await chrome.tabs.update(tab.id, { active: true }).catch(() => void 0);
    const target = { tabId: tab.id };
    let attached = false;
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await chrome.debugger.sendCommand(target, "Page.bringToFront").catch(() => void 0);
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
    if (tab.id === void 0 || tab.windowId === void 0) return;
    try {
      const win = await chrome.windows.get(tab.windowId);
      const MIN_DESKTOP_WIDTH = 1280;
      if ((win.width ?? 0) >= MIN_DESKTOP_WIDTH) return;
      const targetWidth = Math.max(win.width ?? MIN_DESKTOP_WIDTH, MIN_DESKTOP_WIDTH + 320);
      await chrome.windows.update(tab.windowId, {
        width: targetWidth,
        state: win.state === "minimized" ? "normal" : win.state
      });
      await new Promise((resolve) => setTimeout(resolve, 900));
    } catch {
    }
  }
  async function bindRealtimeStartImage(tab, mediaId) {
    if (tab.id === void 0 || !mediaId) {
      throw bridgeError("INVALID_VALUE", "Start Frame requires an exact mediaId.", false);
    }
    await ensureDesktopViewport(tab);
    await chrome.tabs.update(tab.id, { active: true }).catch(() => void 0);
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
      await chrome.debugger.sendCommand(target, "Page.bringToFront").catch(() => void 0);
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
        [...candidate.querySelectorAll('i.google-symbols, .google-symbols')]
          .some((icon) => (icon.textContent || '').trim() === 'more_vert')
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
      await new Promise((resolve) => setTimeout(resolve, 900));
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
    await chrome.tabs.update(tab.id, { active: true }).catch(() => void 0);
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
      await chrome.debugger.sendCommand(target, "Page.bringToFront").catch(() => void 0);
      if (await evaluate(endBoundExpression)) return { ok: true, mediaId };
      const endSlot = await evaluate(`(() => {
      const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]');
      const editorRect = editor?.getBoundingClientRect();
      const element = [...document.querySelectorAll('[type="button"][aria-haspopup="dialog"]')]
        .find((candidate) => /^(K\u1EBFt th\xFAc|End)$/i.test((candidate.textContent || '').trim())
          && (!editorRect || Math.abs(candidate.getBoundingClientRect().top - editorRect.top) < 180));
      if (!element) return { ok: false, reason: 'end-slot-not-found' };
      const rect = element.getBoundingClientRect();
      return rect.width && rect.height
        ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { ok: false, reason: 'end-slot-not-visible' };
    })()`);
      if (!endSlot.ok || endSlot.x === void 0 || endSlot.y === void 0) {
        throw bridgeError("UI_NOT_READY", `Flow End Frame slot was not available (${endSlot.reason ?? "unknown"}).`, true);
      }
      await clickAt(endSlot.x, endSlot.y);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const dialogOpened = await evaluate(`[...document.querySelectorAll('[role="dialog"]')]
      .some((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0)`);
      if (!dialogOpened) {
        const opened = await evaluate(`(() => {
        const element = [...document.querySelectorAll('[type="button"][aria-haspopup="dialog"]')]
          .find((candidate) => /^(K\u1EBFt th\xFAc|End)$/i.test((candidate.textContent || '').trim()));
        element?.click();
        return Boolean(element);
      })()`);
        if (!opened) throw bridgeError("UI_NOT_READY", "Flow End Frame dialog trigger disappeared.", true);
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
      const readDialogMedia = () => evaluate(`((mediaId) => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
      const matches = [...(dialog?.querySelectorAll('img, video, [data-media-id]') || [])]
        .filter((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
          .filter(Boolean).some((value) => String(value).includes(mediaId)))
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
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
      const button = [...(dialog?.querySelectorAll('button') || [])]
        .find((candidate) => /Th\xEAm v\xE0o c\xE2u l\u1EC7nh|Add to prompt/i.test(candidate.innerText || ''));
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
      await new Promise((resolve) => setTimeout(resolve, 750));
      if (!await evaluate(endBoundExpression)) {
        throw bridgeError("MEDIA_FAILED", `Flow did not bind ${mediaId} as the End Frame.`, true);
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
    await chrome.tabs.update(tab.id, { active: true }).catch(() => void 0);
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
      await chrome.debugger.sendCommand(target, "Page.bringToFront").catch(() => void 0);
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
      await chrome.tabs.update(tab.id, { active: true }).catch(() => void 0);
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
    );
    return reply?.ok ? makeResponse(request.requestId, reply) : makeError(
      request.requestId,
      reply?.code ?? "UI_NOT_READY",
      reply?.message ?? "Google Flow did not apply the realtime sync write.",
      true
    );
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

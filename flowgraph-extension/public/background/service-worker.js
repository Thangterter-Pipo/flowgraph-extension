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
    const ratio = normalized.match(/\b\d{1,2}:\d{1,2}\b/)?.[0];
    if (ratio) {
      const byRatio = {
        "16:9": "LANDSCAPE",
        "9:16": "PORTRAIT",
        "1:1": "SQUARE",
        "3:4": "PORTRAIT_3_4",
        "4:3": "LANDSCAPE_4_3"
      };
      const code = byRatio[ratio];
      if (code) return code;
    }
    const map = {
      "16:9 (Landscape)": "LANDSCAPE",
      "9:16 (Portrait)": "PORTRAIT",
      "1:1 (Square)": "SQUARE",
      "3:4 (Portrait)": "PORTRAIT_3_4",
      "4:3 (Landscape)": "LANDSCAPE_4_3"
    };
    const passthrough = normalized.replace("VIDEO_ASPECT_RATIO_", "").replace("IMAGE_ASPECT_RATIO_", "");
    const known = /* @__PURE__ */ new Set(["LANDSCAPE", "PORTRAIT", "SQUARE", "PORTRAIT_3_4", "LANDSCAPE_4_3"]);
    return map[normalized] && known.has(map[normalized]) ? map[normalized] : known.has(passthrough) ? passthrough : void 0;
  }
  function aspectVideo(ratio) {
    const code = aspectCode(ratio) ?? "LANDSCAPE";
    return `VIDEO_ASPECT_RATIO_${code}`;
  }
  function aspectImage(ratio) {
    const code = aspectCode(ratio) ?? "LANDSCAPE";
    return `IMAGE_ASPECT_RATIO_${code}`;
  }
  function buildT2iRequest(payload, context2, batchId) {
    const ctx = context2;
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
  function buildI2vRequest(payload, context2, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context2,
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
  function buildT2vRequest(payload, context2, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context2,
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
  function buildExtendRequest(payload, context2, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context2,
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
  function buildUpsampleRequest(payload, context2, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context2,
      useV2ModelConfig: true,
      requests: [{
        aspectRatio: aspectVideo(payload.aspectRatio),
        videoInput: { mediaId: payload.videoInput.mediaId },
        videoModelKey: payload.modelKey,
        metadata: {}
      }]
    };
  }
  function buildInterpolationRequest(payload, context2, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context2,
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
  function buildReferenceRequest(payload, context2, batchId) {
    return {
      mediaGenerationContext: mediaGenerationContext(batchId),
      clientContext: context2,
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
  function selectAttributedImageMediaId(args) {
    const expected = (args.expectedPrompt ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!expected) return void 0;
    for (const candidate of args.candidates) {
      if (!candidate.mediaId) continue;
      if (candidate.matchedPrompt) return candidate.mediaId;
      if (candidate.editorPrompt && editorPromptMatches(candidate.editorPrompt, expected)) {
        return candidate.mediaId;
      }
    }
    return void 0;
  }

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

  // src/shared/generationAbort.ts
  var GENERATE_PROGRESS_TYPE = "FLOWGRAPH_GENERATE_PROGRESS";
  var abortedIds = /* @__PURE__ */ new Set();
  var inFlight = /* @__PURE__ */ new Map();
  function generationAbortedError() {
    const error = new Error("Generation aborted");
    error.code = "CANCELLED";
    error.retryable = false;
    return error;
  }
  function markGenerationAborted(requestId) {
    if (requestId) abortedIds.add(requestId);
  }
  function isGenerationAborted(requestId) {
    return Boolean(requestId && abortedIds.has(requestId));
  }
  function clearGenerationAbort(requestId) {
    if (requestId) abortedIds.delete(requestId);
  }
  function throwIfGenerationAborted(requestId) {
    if (isGenerationAborted(requestId)) throw generationAbortedError();
  }
  function trackGenerationStart(requestId, projectId) {
    if (requestId) inFlight.set(requestId, { projectId });
  }
  function trackGenerationMedia(requestId, mediaId) {
    if (!requestId || !mediaId) return;
    const row = inFlight.get(requestId);
    if (row) row.mediaId = mediaId;
    else inFlight.set(requestId, { projectId: "", mediaId });
  }
  function getGenerationFlight(requestId) {
    return requestId ? inFlight.get(requestId) : void 0;
  }
  function endGeneration(requestId) {
    if (requestId) inFlight.delete(requestId);
    clearGenerationAbort(requestId);
  }
  async function waitWhileNotAborted(ms, requestId, stepMs = 200) {
    const deadline = Date.now() + Math.max(0, ms);
    const step = Math.max(20, stepMs);
    while (Date.now() < deadline) {
      throwIfGenerationAborted(requestId);
      const slice = Math.min(step, deadline - Date.now());
      if (slice <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, slice));
    }
    throwIfGenerationAborted(requestId);
  }
  async function finalizeGenerateAgainstAbort(requestId, result, cancelByMediaId) {
    if (result.mediaId) trackGenerationMedia(requestId, result.mediaId);
    if (!isGenerationAborted(requestId)) return result;
    if (result.mediaId && cancelByMediaId) {
      await cancelByMediaId(result.mediaId).catch(() => void 0);
    }
    throw generationAbortedError();
  }

  // src/shared/generationPreflight.ts
  var COST_SCALAR_FIELDS = [
    "aspectRatio",
    "durationSeconds",
    "batchCount",
    "targetResolution",
    "seed"
  ];
  function isCostScalarField(field) {
    return COST_SCALAR_FIELDS.includes(field);
  }
  function shouldToleratePreflightFailure(write, reply) {
    if (write.field === "model" || write.field === "seed") return false;
    if (isCostScalarField(write.field)) return reply?.code === "NO_UI_COUNTERPART";
    if (write.optional) return true;
    if (reply?.code === "NO_UI_COUNTERPART") return true;
    return write.field === "mode" || write.field === "prompt";
  }
  function preflightFailureCode(write, reply) {
    if (write.field === "model") return "INVALID_MODEL";
    if (isCostScalarField(write.field)) {
      return reply?.code === "UI_NOT_READY" ? "UI_NOT_READY" : "INVALID_INPUT";
    }
    return reply?.code ?? "PREFLIGHT_FAILED";
  }
  var FLOW_PROMPT_SAFE_LIMIT = 1150;
  function truncateFlowPrompt(prompt) {
    if (prompt.length <= FLOW_PROMPT_SAFE_LIMIT) return prompt;
    return `${prompt.slice(0, FLOW_PROMPT_SAFE_LIMIT).replace(/\s+\S*$/, "")}.`;
  }
  function normalizeComposerPrompt(text) {
    return text.replace(/\s+/g, " ").trim();
  }
  function expectedSubmittedPrompt(prompt) {
    return normalizeComposerPrompt(truncateFlowPrompt(prompt));
  }
  function composerPromptMatchesExpected(liveText, expected) {
    return normalizeComposerPrompt(liveText ?? "") === expected;
  }
  function shouldFailClosedOnMediaBindFailure(kind, slot) {
    if (kind === "i2v" && slot === "startImage") return false;
    return slot === "startImage" || slot === "endImage" || slot === "referenceMedia";
  }
  function slotSourcesContainExactMediaId(sources, mediaId) {
    const id = mediaId.trim();
    if (!id) return false;
    return sources.some((value) => {
      const text = String(value ?? "");
      return text === id || text.includes(id);
    });
  }
  function referenceMediaExactlyBound(requested, applied) {
    return requested.length > 0 && requested.length === applied.length && requested.every((id, index) => id === applied[index]);
  }
  function canSubmitGenerateWithMediaBindings(args) {
    if (args.kind === "interpolation") {
      if (args.hasStart && !args.startBound) return false;
      if (args.hasEnd && !args.endBound) return false;
    }
    if (args.kind === "reference" && args.hasRefs && !args.referenceBound) return false;
    return true;
  }
  var VIDEO_COMPOSER_KINDS = /* @__PURE__ */ new Set([
    "i2v",
    "t2v",
    "extend",
    "interpolation",
    "reference",
    "upscale"
  ]);
  function requiredComposerModality(kind) {
    return kind && VIDEO_COMPOSER_KINDS.has(kind) ? "video" : "image";
  }
  function composerModalityFromChipText(text) {
    const chip = (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!chip) return "unknown";
    if (chip.includes("video") || chip.includes("veo") || chip.includes("omni")) return "video";
    return "image";
  }
  function canSubmitGenerateWithComposerMode(args) {
    return composerModalityFromChipText(args.liveChipText) === requiredComposerModality(args.kind);
  }
  function normalizeFlowModelLabel(value) {
    return value.replace(/🍌/g, " ").replace(/arrow_drop_down/gi, " ").replace(/volume_up/gi, " ").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function canonicalizeFlowModelLabel(value) {
    return normalizeFlowModelLabel(value).replace(/\bomni 1\.1 flash\b/g, "omni flash");
  }
  function flowModelOptionMatchesRequested(optionText, requested) {
    const text = canonicalizeFlowModelLabel(optionText);
    const req = canonicalizeFlowModelLabel(requested);
    if (!text || !req) return false;
    if (text === req) return true;
    const reqPro = /\bpro\b/.test(req);
    const reqLite = /\blite\b/.test(req);
    const reqFast = /\bfast\b/.test(req);
    const reqQuality = /\bquality\b/.test(req);
    const reqLowerPriority = /\blower priority\b/.test(req);
    const textPro = /\bpro\b/.test(text);
    const textLite = /\blite\b/.test(text);
    const textFast = /\bfast\b/.test(text);
    const textQuality = /\bquality\b/.test(text);
    const textLowerPriority = /\blower priority\b/.test(text);
    if (req.includes("banana") || text.includes("banana")) {
      if (!req.includes("banana") || !text.includes("banana")) return false;
      if (reqPro) return textPro && !textLite;
      if (reqLite) return textLite;
      if (req.includes("2")) return /\b2\b/.test(text) && !textLite && !textPro;
      return false;
    }
    if (req.includes("veo") || text.includes("veo")) {
      if (!req.includes("veo") || !text.includes("veo")) return false;
      if (reqLowerPriority !== textLowerPriority) return false;
      if (reqQuality) return textQuality;
      if (reqFast) return textFast && !textQuality;
      if (reqLite) return textLite && !textQuality;
      return false;
    }
    if (req.includes("omni") || text.includes("omni")) {
      if (text.includes("veo") || text.includes("banana")) return false;
      return text.includes("omni") && req.includes("omni");
    }
    return text.endsWith(` ${req}`) || req.endsWith(` ${text}`);
  }
  function composerChipMatchesRequestedModel(chipText, requested) {
    return flowModelOptionMatchesRequested(chipText ?? "", requested);
  }
  function shouldFailClosedWhenDebuggerUnavailable(attached) {
    return !attached;
  }
  function canSubmitGenerateWithScalarSettings(args) {
    for (const field of COST_SCALAR_FIELDS) {
      const value = args.requested[field];
      if (value === void 0 || value === null || value === "") continue;
      if (field === "seed") {
        if (!args.verified.seed) return false;
        continue;
      }
      if (args.verified[field] || args.fixedByModel?.[field]) continue;
      return false;
    }
    return true;
  }

  // src/adapters/google-flow/batch/FlowBatchProtocol.ts
  var FLOW_BATCH_PATH = "/_/AiSandboxAngularFrontend/data/batchexecute";
  var FLOW_BATCH_MEDIA_HOST = "flow-content.google";
  var FLOW_BATCH_CAPTCHA_SLOT = "__CAPTCHA__";
  var FLOW_BATCH_RPC = {
    GENERATE_IMAGE: "ogiZ0b",
    GENERATE_VIDEO: "eb1hJf",
    GENERATE_VIDEO_TEXT: "YhhmEf",
    GENERATE_VIDEO_FIRST_LAST: "nprQif",
    GENERATE_VIDEO_REFERENCES: "MZZa6b",
    OPERATION: "jwpduf",
    PROJECT_MEDIA: "Zzl0ze",
    MEDIA: "as29s",
    UPLOAD_IMAGE: "maseQ",
    UPSCALE_IMAGE: "SPrCad"
  };
  var FLOW_BATCH_CAPTCHA_ACTION = {
    IMAGE: "IMAGE_GENERATION",
    VIDEO: "VIDEO_GENERATION"
  };
  var defaultIdFactory = () => crypto.randomUUID().toUpperCase();
  var SURFACE_ID = 22;
  var FULL_FRAME_CROP = [null, 0.0038759689922481244, 1, 0.9961240310077519];
  var REF_TYPE_IMAGE = 1;
  var BASE_TYPE_IMAGE = 2;
  var IMAGE_MODEL_ALIASES = {
    NANO_BANANA_PRO: "GEM_PIX_2",
    NANO_BANANA_2: "NARWHAL",
    NANO_BANANA_2_LITE: "HARBOR_SEAL",
    NANO_BANANA_LITE: "HARBOR_SEAL"
  };
  var IMAGE_MODEL_ID_RE = /^[A-Z][A-Z0-9_]{1,95}$/;
  var IMAGE_ASPECT_BY_NAME = {
    IMAGE_ASPECT_RATIO_SQUARE: 1,
    IMAGE_ASPECT_RATIO_PORTRAIT: 2,
    IMAGE_ASPECT_RATIO_LANDSCAPE: 3,
    IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR: 4,
    IMAGE_ASPECT_RATIO_PORTRAIT_FOUR_THREE: 4,
    IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE: 5,
    "1:1": 1,
    "9:16": 2,
    "16:9": 3,
    "3:4": 4,
    "4:3": 5
  };
  var VIDEO_ASPECT_BY_NAME = {
    VIDEO_ASPECT_RATIO_PORTRAIT: 1,
    VIDEO_ASPECT_RATIO_LANDSCAPE: 2,
    "9:16": 1,
    "16:9": 2
  };
  var FlowBatchProtocolError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "FlowBatchProtocolError";
    }
  };
  var FlowBatchRpcError = class extends Error {
    constructor(rpcId, detail) {
      super(`${rpcId} failed: ${JSON.stringify(detail)}`);
      this.rpcId = rpcId;
      this.detail = detail;
      this.name = "FlowBatchRpcError";
    }
  };
  function resolveFlowImageModel(model2) {
    if (typeof model2 !== "string") return "GEM_PIX_2";
    const normalized = model2.trim().toUpperCase().replace(/-/g, "_");
    if (IMAGE_MODEL_ALIASES[normalized]) return IMAGE_MODEL_ALIASES[normalized];
    if (IMAGE_MODEL_ID_RE.test(normalized)) return normalized;
    return "GEM_PIX_2";
  }
  function resolveFlowImageAspect(aspect) {
    if (typeof aspect === "number" && Number.isInteger(aspect) && aspect >= 1 && aspect <= 5) {
      return aspect;
    }
    const key = typeof aspect === "string" ? aspect.match(/\b(?:1:1|9:16|16:9|3:4|4:3)\b/)?.[0] ?? aspect.trim() : "";
    const value = IMAGE_ASPECT_BY_NAME[key];
    if (value) return value;
    throw new FlowBatchProtocolError(`Unknown image aspect: ${String(aspect)}`);
  }
  function resolveFlowFirstLastModelKey(model2) {
    const key = String(model2 || "").trim();
    const match = key.match(/^abra_i2v_(4|6|8|10)s(_360p)?$/i);
    if (match) {
      return `omni_flash_i2v_${match[1]}s_first_last${match[2] ?? ""}`;
    }
    return key;
  }
  function resolveFlowVideoAspect(aspect) {
    if (aspect === 1 || aspect === 2) return aspect;
    const key = typeof aspect === "string" ? aspect.match(/\b(?:9:16|16:9)\b/)?.[0] ?? aspect.trim() : "";
    const value = VIDEO_ASPECT_BY_NAME[key];
    if (value) return value;
    throw new FlowBatchProtocolError(`Unknown video aspect: ${String(aspect)}`);
  }
  function buildFlowBatchEnvelope(rpcId, inner) {
    return JSON.stringify([[[rpcId, JSON.stringify(inner), null, "generic"]]]);
  }
  function context(projectId) {
    return [null, SURFACE_ID, null, null, null, projectId, null, null, null, null, [FLOW_BATCH_CAPTCHA_SLOT, 1]];
  }
  function imageInput(mediaId, inputType) {
    return [mediaId, null, null, null, inputType];
  }
  function buildFlowImageRequest(options) {
    const idFactory = options.idFactory ?? defaultIdFactory;
    const inputs = [];
    if (options.baseMediaId) inputs.push(imageInput(options.baseMediaId, BASE_TYPE_IMAGE));
    for (const mediaId of options.referenceMediaIds ?? []) {
      if (mediaId && mediaId !== options.baseMediaId) inputs.push(imageInput(mediaId, REF_TYPE_IMAGE));
    }
    const item = [
      null,
      null,
      inputs.length ? inputs : null,
      options.seed ?? Math.floor(Math.random() * 1e9) + 1,
      resolveFlowImageAspect(options.aspect ?? "1:1"),
      resolveFlowImageModel(options.model),
      null,
      context(options.projectId),
      [[[options.prompt]]],
      null,
      null,
      null,
      idFactory(),
      idFactory()
    ];
    return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_IMAGE, [
      null,
      [item],
      1,
      context(options.projectId),
      [idFactory()]
    ]);
  }
  function buildFlowFirstFrameVideoRequest(options) {
    const idFactory = options.idFactory ?? defaultIdFactory;
    const request = [
      [null, null, [[[options.prompt]]]],
      options.model,
      resolveFlowVideoAspect(options.aspect ?? "16:9"),
      null,
      [null, options.sourceMediaId, null, null, null, options.crop ?? FULL_FRAME_CROP],
      [null, null, null, null, idFactory(), idFactory()]
    ];
    return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_VIDEO, [
      [request],
      context(options.projectId),
      [idFactory(), 2]
    ]);
  }
  function buildFlowTextVideoRequest(options) {
    const idFactory = options.idFactory ?? defaultIdFactory;
    const request = [
      [null, null, [[[options.prompt]]]],
      options.model,
      resolveFlowVideoAspect(options.aspect ?? "16:9"),
      null,
      [null, null, null, null, idFactory(), idFactory()]
    ];
    return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_VIDEO_TEXT, [
      [request],
      context(options.projectId),
      [idFactory(), 1]
    ]);
  }
  function buildFlowFirstLastVideoRequest(options) {
    const idFactory = options.idFactory ?? defaultIdFactory;
    const request = [
      [null, null, [[[options.prompt]]]],
      options.model,
      resolveFlowVideoAspect(options.aspect ?? "16:9"),
      null,
      [null, options.startMediaId, null, null, null, options.startCrop ?? FULL_FRAME_CROP],
      [null, options.endMediaId, null, null, null, options.endCrop ?? FULL_FRAME_CROP],
      [null, null, null, null, idFactory(), idFactory()]
    ];
    return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_VIDEO_FIRST_LAST, [
      [request],
      context(options.projectId),
      [idFactory(), 2]
    ]);
  }
  function buildFlowReferenceVideoRequest(options) {
    const refs = options.referenceMediaIds.filter(Boolean);
    if (!refs.length) throw new FlowBatchProtocolError("Reference video requires at least one image.");
    const idFactory = options.idFactory ?? defaultIdFactory;
    const request = [
      [null, null, [[[options.prompt]]]],
      refs.map((mediaId) => [null, mediaId]),
      options.model,
      resolveFlowVideoAspect(options.aspect ?? "16:9"),
      null,
      [null, null, null, null, idFactory(), idFactory()]
    ];
    return buildFlowBatchEnvelope(FLOW_BATCH_RPC.GENERATE_VIDEO_REFERENCES, [
      [request],
      context(options.projectId),
      [idFactory(), 2]
    ]);
  }
  function buildFlowOperationRequest(operationId) {
    return buildFlowBatchEnvelope(FLOW_BATCH_RPC.OPERATION, [null, null, [[operationId]]]);
  }
  function buildFlowProjectMediaRequest(projectId) {
    return buildFlowBatchEnvelope(FLOW_BATCH_RPC.PROJECT_MEDIA, [`projects/${projectId}`, null, null, null, [1]]);
  }
  function buildFlowMediaRequest(mediaId) {
    return buildFlowBatchEnvelope(FLOW_BATCH_RPC.MEDIA, [mediaId]);
  }
  function walkStrings(node) {
    if (typeof node === "string") return [node];
    if (!Array.isArray(node)) return [];
    return node.flatMap((item) => walkStrings(item));
  }
  function walkLists(node) {
    if (!Array.isArray(node)) return [];
    return [node, ...node.flatMap((item) => walkLists(item))];
  }
  function parseFlowBatchEnvelope(text) {
    if (!text) return [];
    const body = text.startsWith(")]}'") ? text.slice(text.indexOf("\n") + 1) : text;
    const results = [];
    let index = 0;
    while (index < body.length) {
      const start = body.indexOf("[", index);
      if (start < 0) break;
      let parsed = null;
      let consumedEnd = -1;
      let probe = body.indexOf("\n", start);
      while (probe >= 0) {
        const candidate = body.slice(start, probe).trim();
        try {
          parsed = JSON.parse(candidate);
          consumedEnd = probe + 1;
          break;
        } catch {
          probe = body.indexOf("\n", probe + 1);
        }
      }
      if (consumedEnd < 0) {
        const candidate = body.slice(start).trim();
        try {
          parsed = JSON.parse(candidate);
          consumedEnd = body.length;
        } catch {
          index = start + 1;
          continue;
        }
      }
      index = consumedEnd;
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        if (!Array.isArray(entry) || entry[0] !== "wrb.fr") continue;
        const rpcId = typeof entry[1] === "string" ? entry[1] : "?";
        const payload = entry[2];
        if (payload == null) {
          results.push({ rpcId, data: null, error: entry[5] ?? true });
          continue;
        }
        if (typeof payload === "string") {
          try {
            results.push({ rpcId, data: JSON.parse(payload) });
          } catch {
            results.push({ rpcId, data: payload });
          }
        } else {
          results.push({ rpcId, data: payload });
        }
      }
    }
    return results;
  }
  function firstFlowBatchPayload(text, rpcId) {
    const result = parseFlowBatchEnvelope(text).find((candidate) => candidate.rpcId === rpcId);
    if (!result) throw new FlowBatchProtocolError(`No ${rpcId} envelope in response`);
    if (result.error !== void 0) throw new FlowBatchRpcError(rpcId, result.error);
    return result.data;
  }
  function readFlowGeneratedImages(payload) {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const value of walkStrings(payload)) {
      const marker = `${FLOW_BATCH_MEDIA_HOST}/image/`;
      if (!value.includes(marker)) continue;
      const mediaId = value.split(marker, 2)[1]?.split("?", 1)[0];
      if (!mediaId || seen.has(mediaId)) continue;
      seen.add(mediaId);
      result.push({ mediaId, url: value });
    }
    return result;
  }
  function readFlowTextVideoSubmit(payload) {
    const root = Array.isArray(payload) ? payload : [];
    const records = Array.isArray(root[3]) ? root[3] : [];
    const record = Array.isArray(records[0]) ? records[0] : null;
    if (!record || typeof record[0] !== "string" || !record[0]) {
      throw new FlowBatchProtocolError("Text-video submit carried no media id.");
    }
    return {
      mediaId: record[0],
      projectId: typeof record[1] === "string" ? record[1] : void 0,
      workflowId: typeof record[2] === "string" ? record[2] : record[0],
      status: typeof record[3] === "string" ? record[3] : void 0
    };
  }
  function readFlowOperation(payload) {
    const root = Array.isArray(payload) ? payload : [];
    const records = Array.isArray(root[2]) ? root[2] : [];
    const record = Array.isArray(records[0]) ? records[0] : null;
    if (!record || typeof record[0] !== "string") {
      throw new FlowBatchProtocolError("Operation payload carried no operation id");
    }
    let error;
    const detail = record[5];
    if (Array.isArray(detail) && Array.isArray(detail[8]) && detail[8][0] === 4) {
      error = walkStrings(detail[8])[0] ?? "operation complaint";
    }
    return {
      operationId: record[0],
      projectId: typeof record[1] === "string" ? record[1] : void 0,
      status: typeof record[3] === "string" ? record[3] : void 0,
      error
    };
  }
  function findFlowMediaId(payload, operationId) {
    for (const node of walkLists(payload)) {
      if (node.length < 4 || node[0] !== operationId || !Array.isArray(node[3])) continue;
      const detail = node[3];
      if (typeof detail[4] === "string") return detail[4];
    }
    return void 0;
  }
  var MEDIA_SLOT_RE = /null,null,\\?"([0-9a-fA-F-]{36})\\?"/;
  function findFlowMediaIdInText(text, operationId) {
    const start = text.indexOf(operationId);
    if (start < 0) return void 0;
    return MEDIA_SLOT_RE.exec(text.slice(start, start + 800))?.[1];
  }
  function readFlowMediaUrls(payload, mediaId) {
    const result = { mediaId };
    for (const value of walkStrings(payload)) {
      if (!value.startsWith("https://")) continue;
      if (!result.video && value.includes(`${FLOW_BATCH_MEDIA_HOST}/video/`)) result.video = value;
      else if (!result.image && value.includes(`${FLOW_BATCH_MEDIA_HOST}/image/`)) result.image = value;
    }
    return result;
  }

  // src/adapters/google-flow/batch/FlowBatchPolling.ts
  var FlowBatchVideoPoller = class {
    constructor(executor) {
      this.executor = executor;
    }
    operationProjects = /* @__PURE__ */ new Map();
    operationMedia = /* @__PURE__ */ new Map();
    operationPolls = /* @__PURE__ */ new Map();
    rememberOperation(operationId, projectId) {
      if (!operationId) return;
      if (this.operationProjects.size > 512) {
        this.operationProjects.clear();
        this.operationMedia.clear();
        this.operationPolls.clear();
      }
      this.operationProjects.set(operationId, projectId);
    }
    async pollMedia(mediaId, projectId) {
      const raw = await this.executor.run(
        FLOW_BATCH_RPC.MEDIA,
        buildFlowMediaRequest(mediaId)
      );
      const payload = firstFlowBatchPayload(raw, FLOW_BATCH_RPC.MEDIA);
      const urls = readFlowMediaUrls(payload, mediaId);
      if (!urls.video) {
        return {
          status: "PENDING",
          projectId,
          mediaId,
          posterUrl: urls.image
        };
      }
      return {
        status: "SUCCESSFUL",
        projectId,
        mediaId,
        url: urls.video,
        posterUrl: urls.image
      };
    }
    async pollOperation(operationId, fallbackProjectId) {
      const cachedMediaId = this.operationMedia.get(operationId);
      if (cachedMediaId) {
        const result2 = await this.pollMedia(
          cachedMediaId,
          this.operationProjects.get(operationId) ?? fallbackProjectId
        );
        return { ...result2, operationId };
      }
      const round = (this.operationPolls.get(operationId) ?? 0) + 1;
      this.operationPolls.set(operationId, round);
      let projectId = this.operationProjects.get(operationId) ?? fallbackProjectId;
      let complaint;
      let shouldConsultListing = round % 3 === 0;
      try {
        const raw = await this.executor.run(
          FLOW_BATCH_RPC.OPERATION,
          buildFlowOperationRequest(operationId)
        );
        const operation = readFlowOperation(
          firstFlowBatchPayload(raw, FLOW_BATCH_RPC.OPERATION)
        );
        complaint = operation.error;
        projectId = operation.projectId ?? projectId;
        if (projectId) this.rememberOperation(operationId, projectId);
        shouldConsultListing = shouldConsultListing || operation.status === "CAE" || Boolean(operation.error);
      } catch {
        shouldConsultListing = true;
      }
      if (!shouldConsultListing || !projectId) {
        return {
          status: "PENDING",
          operationId,
          projectId,
          complaint
        };
      }
      const mediaId = await this.findMediaId(operationId, projectId);
      if (!mediaId) {
        return {
          status: "PENDING",
          operationId,
          projectId,
          complaint
        };
      }
      this.operationMedia.set(operationId, mediaId);
      const result = await this.pollMedia(mediaId, projectId);
      return {
        ...result,
        operationId,
        complaint
      };
    }
    async findMediaId(operationId, projectId) {
      const raw = await this.executor.run(
        FLOW_BATCH_RPC.PROJECT_MEDIA,
        buildFlowProjectMediaRequest(projectId),
        { match: operationId }
      );
      const fromWindow = findFlowMediaIdInText(raw, operationId);
      if (fromWindow) return fromWindow;
      try {
        return findFlowMediaId(
          firstFlowBatchPayload(raw, FLOW_BATCH_RPC.PROJECT_MEDIA),
          operationId
        );
      } catch {
        return void 0;
      }
    }
  };

  // src/adapters/google-flow/FlowCapabilityRouter.ts
  function model(payload) {
    return String(payload.modelKey || "").trim().toLowerCase();
  }
  function resolveFlowCapabilityRoute(payload) {
    const key = model(payload);
    switch (payload.kind) {
      case "t2i":
        return {
          primary: "BATCH_RPC",
          fallback: "FLOW_UI",
          reason: "Image generation ogiZ0b is captured on the current Flow frontend."
        };
      case "t2v":
        if (key.startsWith("abra_t2v_")) {
          return {
            primary: "BATCH_RPC",
            fallback: "FLOW_UI",
            reason: "Omni text-to-video YhhmEf is captured; UI remains a compatibility fallback."
          };
        }
        return {
          primary: "FLOW_UI",
          reason: "Non-Omni T2V batch payload is not assumed from Omni captures."
        };
      case "i2v":
        if (key.startsWith("abra_i2v_")) {
          return {
            primary: "BATCH_RPC",
            fallback: "FLOW_UI",
            reason: "Omni first-frame I2V uses captured eb1hJf positional payload."
          };
        }
        return {
          primary: "FLOW_UI",
          reason: "Veo I2V remains on FlowGraph's verified UI path until its current batch shape is live-verified locally."
        };
      case "interpolation":
        if (key.startsWith("abra_i2v_") || key.startsWith("omni_flash_i2v_")) {
          return {
            primary: "BATCH_RPC",
            fallback: "FLOW_UI",
            reason: "Omni First+Last uses captured nprQif."
          };
        }
        return {
          primary: "FLOW_UI",
          reason: "Veo start/end is not inferred from the Omni nprQif capture."
        };
      case "reference":
        if (key.startsWith("abra_r2v_")) {
          return {
            primary: "BATCH_RPC",
            fallback: "FLOW_UI",
            reason: "Omni Ingredients/reference video uses captured MZZa6b."
          };
        }
        return {
          primary: "FLOW_UI",
          reason: "Veo reference-video is not inferred from the Omni MZZa6b capture."
        };
      case "imageUpscale":
        return {
          primary: "BATCH_RPC",
          fallback: "FLOW_UI",
          reason: "Image upscale SPrCad is captured; Flow UI remains fallback for entitlement/rollout differences."
        };
      case "videoUpscale":
      case "upscale":
        return {
          primary: "LEGACY_REST",
          reason: "Temporary migration hold: current batch video-upscale RPC is not captured. Remove legacy route after a verified replacement exists."
        };
      case "extend":
        return {
          primary: "FLOW_UI",
          reason: "Video extend/edit has no current FlowKit batch capture; keep FlowGraph verified UI path."
        };
      default:
        return {
          primary: "UNSUPPORTED",
          reason: `No Google Flow transport route for ${String(payload.kind)}.`
        };
    }
  }
  function mayFallbackFromBatch(errorCode) {
    return (/* @__PURE__ */ new Set([
      "NO_AT_TOKEN",
      "NO_INJECTION_RESULT",
      "BATCH_HTTP_ERROR",
      "BATCH_PROTOCOL_ERROR",
      "BATCH_RPC_UNAVAILABLE"
    ])).has(errorCode);
  }

  // src/background/FlowBatchPageTransport.ts
  var FlowBatchPageTransportError = class extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
      this.name = "FlowBatchPageTransportError";
    }
  };
  async function runFlowBatchPageRpc(options) {
    const maxText = options.maxText ?? 32e6;
    const results = await chrome.scripting.executeScript({
      target: { tabId: options.tabId },
      world: "MAIN",
      args: [options.rpcId, options.fReq, options.match ?? null, maxText, FLOW_BATCH_PATH],
      func: async (rpcId, fReq, match, textLimit, batchPath) => {
        const page = globalThis;
        const wiz = page.WIZ_global_data ?? {};
        const at = wiz.SNlM0e;
        if (!at) return { error: "NO_AT_TOKEN" };
        const sid = wiz.FdrFJe ?? "";
        const bl = wiz.cfb2h ?? "";
        const reqId = Math.floor(Math.random() * 9e5) + 1e5;
        const sourcePath = location.pathname || "/";
        const language = (document.documentElement.lang || navigator.language || "en").split("-")[0];
        const url = `${batchPath}?rpcids=${encodeURIComponent(rpcId)}&source-path=${encodeURIComponent(sourcePath)}&bl=${encodeURIComponent(bl)}&f.sid=${encodeURIComponent(sid)}&hl=${encodeURIComponent(language)}&_reqid=${reqId}&rt=c`;
        const response = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            "x-same-domain": "1"
          },
          body: new URLSearchParams({ "f.req": fReq, at })
        });
        const text2 = await response.text();
        if (match) {
          const index = text2.indexOf(match);
          return {
            status: response.status,
            matched: index >= 0,
            text: index >= 0 ? text2.slice(index, index + 800) : ""
          };
        }
        return {
          status: response.status,
          text: text2.slice(0, textLimit)
        };
      }
    });
    const result = results?.[0]?.result;
    if (!result) {
      throw new FlowBatchPageTransportError(
        "NO_INJECTION_RESULT",
        "Flow batch RPC returned no MAIN-world injection result."
      );
    }
    if (result.error === "NO_AT_TOKEN") {
      throw new FlowBatchPageTransportError(
        "NO_AT_TOKEN",
        "The current Flow page has no WIZ at token. Reload the signed-in Flow project and retry."
      );
    }
    const status = result.status ?? 0;
    const text = result.text ?? "";
    if (status < 200 || status >= 300) {
      throw new FlowBatchPageTransportError(
        "BATCH_HTTP_ERROR",
        `Flow batch RPC ${options.rpcId} returned HTTP ${status}.`,
        status
      );
    }
    return {
      status,
      text,
      matched: result.matched
    };
  }

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
  var SYNC_WRITE_TIMEOUT_MS = 1e4;
  var DOWNLOAD_TIMEOUT_MS = DOWNLOAD_TRANSFER_BUDGET_MS;
  var FLOW_SITEKEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
  var PROXY_FETCH_ALLOWED_HOSTS = /* @__PURE__ */ new Set([]);
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
  async function cdpClickAt(target, x, y, holdMs = 80, requestId) {
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    if (requestId !== void 0) {
      await waitWhileNotAborted(holdMs, requestId);
    } else {
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
  }
  var session = null;
  var activeProjectId = null;
  function sessionFresh() {
    return session !== null && Date.now() - session.obtainedAt < TOKEN_TTL_MS;
  }
  async function ensureSession() {
    if (sessionFresh()) return session;
    const tab = await findFlowTab();
    if (!tab || tab.id === void 0) {
      throw bridgeError("NO_FLOW_TAB", "Google Flow tab required. Open flow.google.com to authorize session.", true);
    }
    let reply = null;
    try {
      reply = await timeoutable(chrome.tabs.sendMessage(tab.id, { type: "GET_FX_SESSION" }), REQUEST_TIMEOUT_MS);
    } catch {
      reply = null;
    }
    if (!reply?.ok || !reply.token) {
      reply = await fetchSessionDirect();
    }
    if (!reply?.ok || !reply.token) {
      throw bridgeError("AUTH_EXPIRED", reply?.message ?? "Flow session could not be refreshed from the active Google Flow tab.", true);
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
  async function findFlowTab(expectedProjectId) {
    const tabs = await chrome.tabs.query({});
    const candidates = tabs.filter(
      (tab) => tab.id !== void 0 && isFlowUrl(tab.url ?? "")
    );
    if (candidates.length === 0) return null;
    const score = (tab) => {
      const projectId = projectIdFromUrl(tab.url ?? "");
      if (expectedProjectId && projectId === expectedProjectId) return 2e3;
      if (activeProjectId && projectId === activeProjectId) return 1e3;
      if (tab.active) return 500;
      if (projectId) return 250;
      return 0;
    };
    const chosenTab = candidates.sort(
      (a, b) => score(b) - score(a) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)
    )[0] ?? null;
    if (chosenTab && chosenTab.id !== void 0) {
      void ensureFlowContentScript(chosenTab.id).catch(() => void 0);
    }
    return chosenTab;
  }
  async function ensureFlowContentScript(tabId) {
    const bridgeReady = async () => {
      try {
        const ping = await timeoutable(
          chrome.tabs.sendMessage(tabId, { type: "FLOWGRAPH_PING_FLOW" }),
          700
        );
        return Boolean(ping?.ok);
      } catch {
        return false;
      }
    };
    if (await bridgeReady()) return;
    let injectionError = "";
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/flow-content-script.js"]
      });
    } catch (error) {
      injectionError = error instanceof Error ? error.message : String(error);
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 120));
      if (await bridgeReady()) return;
    }
    throw bridgeError(
      "BRIDGE_UNAVAILABLE",
      `Flow content bridge did not become ready after injection${injectionError ? `: ${injectionError}` : "."}`,
      true
    );
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
    if (status === 401) {
      session = null;
      return bridgeError("AUTH_EXPIRED", "Google Flow session expired. Refresh the Flow tab and retry.", true);
    }
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
  async function recaptchaToken(projectId, action = "FLOW_GENERATE") {
    void projectId;
    const tab = await findFlowTab();
    if (!tab || tab.id === void 0) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const results = await timeoutable(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [FLOW_SITEKEY, action],
        func: async (sitekey, action2) => {
          const pageWindow = window;
          const execute = pageWindow.grecaptcha?.enterprise?.execute;
          if (!execute) return { ok: false, message: "reCAPTCHA Enterprise widget is not ready on the Google Flow page." };
          try {
            const token = await execute(sitekey, { action: action2 });
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
  var FLOW_BATCH_IMAGE_SUBMIT_OFFSETS_MS = [0, 500, 1500, 2500];
  var FLOW_BATCH_IMAGE_TRANSIENT_RETRY_DELAY_MS = 34e3;
  function recordBatchDiagnostic(capability, error) {
    try {
      void chrome.storage.local.set({
        "flowgraph.debug.lastBatchError": {
          capability,
          code: String(error.code ?? "UNKNOWN"),
          message: error.message,
          at: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch {
    }
  }
  function toFlowBatchBridgeError(error) {
    if (error instanceof FlowBatchPageTransportError) {
      return bridgeError(error.code, error.message, true);
    }
    if (error instanceof FlowBatchProtocolError) {
      return bridgeError("BATCH_PROTOCOL_ERROR", error.message, true);
    }
    if (error instanceof FlowBatchRpcError) {
      const transient = JSON.stringify(error.detail) === "[8]";
      return bridgeError("PROVIDER_ERROR", error.message, transient);
    }
    if (typeof error === "object" && error !== null && "code" in error) {
      return error;
    }
    return bridgeError(
      "BATCH_RPC_UNAVAILABLE",
      error instanceof Error ? error.message : String(error),
      true
    );
  }
  function isTransientFlowBatchImageError(error) {
    return error instanceof FlowBatchRpcError && JSON.stringify(error.detail) === "[8]";
  }
  async function waitForBatchOffset(ms, requestId) {
    if (ms <= 0) return;
    if (requestId) {
      await waitWhileNotAborted(ms, requestId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function submitFlowBatchImageVariant(tabId, payload, variantIndex, launchOffsetMs, requestId) {
    await waitForBatchOffset(launchOffsetMs, requestId);
    throwIfGenerationAborted(requestId);
    const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.IMAGE);
    throwIfGenerationAborted(requestId);
    const seed = payload.seed !== void 0 ? payload.seed + variantIndex * 9973 : void 0;
    const fReq = buildFlowImageRequest({
      prompt: payload.prompt ?? "",
      projectId: payload.projectId,
      model: payload.modelKey,
      aspect: payload.aspectRatio ?? "16:9",
      seed,
      referenceMediaIds: (payload.imageRefs ?? []).map((reference) => reference.mediaId)
    }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);
    const result = await timeoutable(
      runFlowBatchPageRpc({
        tabId,
        rpcId: FLOW_BATCH_RPC.GENERATE_IMAGE,
        fReq
      }),
      12e4
    );
    throwIfGenerationAborted(requestId);
    const providerPayload = firstFlowBatchPayload(result.text, FLOW_BATCH_RPC.GENERATE_IMAGE);
    const generated = readFlowGeneratedImages(providerPayload);
    if (!generated.length) {
      throw new FlowBatchProtocolError("Image generation returned no flow-content.google image URL.");
    }
    return generated[0];
  }
  async function generateT2iViaBatch(payload, requestId) {
    const prompt = (payload.prompt ?? "").trim();
    if (!prompt) throw bridgeError("INVALID_INPUT", "Text-to-Image requires a non-empty prompt.", false);
    const tab = await findFlowTab(payload.projectId);
    if (!tab?.id) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const liveProjectId = projectIdFromUrl(tab.url ?? "");
    if (!liveProjectId || liveProjectId !== payload.projectId) {
      throw bridgeError(
        "PROJECT_MISMATCH",
        `Active Google Flow tab project (${liveProjectId || "none"}) does not match request projectId (${payload.projectId}).`,
        false
      );
    }
    const count = Math.min(4, Math.max(1, Math.floor(payload.batchCount ?? 1)));
    const indices = Array.from({ length: count }, (_unused, index) => index);
    const firstWave = await Promise.allSettled(
      indices.map((index) => submitFlowBatchImageVariant(
        tab.id,
        payload,
        index,
        FLOW_BATCH_IMAGE_SUBMIT_OFFSETS_MS[index] ?? 0,
        requestId
      ))
    );
    const results = [...firstWave];
    const retryIndices = results.map((result, index) => ({ result, index })).filter(({ result }) => result.status === "rejected" && isTransientFlowBatchImageError(result.reason)).map(({ index }) => index);
    if (retryIndices.length) {
      await waitForBatchOffset(FLOW_BATCH_IMAGE_TRANSIENT_RETRY_DELAY_MS, requestId);
      const retried = await Promise.allSettled(
        retryIndices.map((index, position) => submitFlowBatchImageVariant(
          tab.id,
          payload,
          index,
          FLOW_BATCH_IMAGE_SUBMIT_OFFSETS_MS[position] ?? 0,
          requestId
        ))
      );
      retryIndices.forEach((index, position) => {
        results[index] = retried[position];
      });
    }
    const primary = results.find(
      (result) => result.status === "fulfilled"
    );
    if (!primary) {
      const failure = results.find(
        (result) => result.status === "rejected"
      );
      throw failure?.reason ?? new FlowBatchProtocolError("All image variants failed.");
    }
    return completeGenerate(requestId, {
      mediaId: primary.value.mediaId,
      type: "IMAGE",
      projectId: payload.projectId,
      previewUrl: primary.value.url,
      mimeType: "image/jpeg"
    }, payload.projectId);
  }
  var flowBatchPollers = /* @__PURE__ */ new Map();
  function flowBatchPollerForTab(tabId) {
    const existing = flowBatchPollers.get(tabId);
    if (existing) return existing;
    const created = new FlowBatchVideoPoller({
      run: async (rpcId, fReq, options) => (await runFlowBatchPageRpc({
        tabId,
        rpcId,
        fReq,
        match: options?.match
      })).text
    });
    flowBatchPollers.set(tabId, created);
    return created;
  }
  function assertSingleBatchVideoSettingsSupported(payload, label) {
    const count = Math.max(1, Math.floor(payload.batchCount ?? 1));
    if (count > 1) {
      throw bridgeError(
        "BATCH_RPC_UNAVAILABLE",
        `${label} batch transport currently preserves x1 only; requested x${count} must use the verified Flow UI path.`,
        true
      );
    }
    if (payload.seed !== void 0) {
      throw bridgeError(
        "BATCH_RPC_UNAVAILABLE",
        `${label} batch capture does not prove a seed slot; explicit seed must use the verified Flow UI path.`,
        true
      );
    }
    const resolution = String(payload.targetResolution ?? "").trim().toLowerCase();
    if (resolution && resolution !== "720p") {
      throw bridgeError(
        "BATCH_RPC_UNAVAILABLE",
        `${label} batch transport is enabled only for captured 720p/default payloads; requested ${payload.targetResolution} must use the verified Flow UI path.`,
        true
      );
    }
  }
  async function waitForFlowBatchOperationMedia(tabId, operationId, projectId, requestId) {
    const poller = flowBatchPollerForTab(tabId);
    poller.rememberOperation(operationId, projectId);
    const deadline = Date.now() + MEDIA_WAIT_VIDEO_MS;
    let complaint = "";
    while (Date.now() <= deadline) {
      throwIfGenerationAborted(requestId);
      const result = await poller.pollOperation(operationId, projectId);
      complaint = result.complaint ?? complaint;
      if (result.mediaId) {
        emitGenerateProgress(requestId, result.mediaId);
        return {
          mediaId: result.mediaId,
          previewUrl: result.url
        };
      }
      await waitForBatchOffset(3e3, requestId);
    }
    throw bridgeError(
      "TIMEOUT",
      `Flow batch operation ${operationId} did not expose a media id before the video deadline${complaint ? `: ${complaint}` : "."}`,
      true
    );
  }
  async function generateT2vViaBatch(payload, requestId) {
    const prompt = (payload.prompt ?? "").trim();
    if (!prompt) throw bridgeError("INVALID_INPUT", "Text-to-Video requires a non-empty prompt.", false);
    assertSingleBatchVideoSettingsSupported(payload, "Omni Text-to-Video");
    const tab = await findFlowTab(payload.projectId);
    if (!tab?.id) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const liveProjectId = projectIdFromUrl(tab.url ?? "");
    if (!liveProjectId || liveProjectId !== payload.projectId) {
      throw bridgeError(
        "PROJECT_MISMATCH",
        `Active Google Flow tab project (${liveProjectId || "none"}) does not match request projectId (${payload.projectId}).`,
        false
      );
    }
    throwIfGenerationAborted(requestId);
    const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.VIDEO);
    throwIfGenerationAborted(requestId);
    const fReq = buildFlowTextVideoRequest({
      prompt,
      projectId: payload.projectId,
      model: payload.modelKey,
      aspect: payload.aspectRatio ?? "16:9"
    }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);
    const result = await timeoutable(
      runFlowBatchPageRpc({
        tabId: tab.id,
        rpcId: FLOW_BATCH_RPC.GENERATE_VIDEO_TEXT,
        fReq
      }),
      12e4
    );
    throwIfGenerationAborted(requestId);
    const submitted = readFlowTextVideoSubmit(
      firstFlowBatchPayload(result.text, FLOW_BATCH_RPC.GENERATE_VIDEO_TEXT)
    );
    emitGenerateProgress(requestId, submitted.mediaId);
    return completeGenerate(requestId, {
      mediaId: submitted.mediaId,
      type: "VIDEO",
      projectId: submitted.projectId ?? payload.projectId,
      workflowId: submitted.workflowId
    }, payload.projectId);
  }
  async function completeOperationBackedBatchVideo(tabId, payload, rpcId, responseText, requestId) {
    const operation = readFlowOperation(firstFlowBatchPayload(responseText, rpcId));
    const media = await waitForFlowBatchOperationMedia(
      tabId,
      operation.operationId,
      operation.projectId ?? payload.projectId,
      requestId
    );
    return completeGenerate(requestId, {
      mediaId: media.mediaId,
      type: "VIDEO",
      projectId: operation.projectId ?? payload.projectId,
      workflowId: operation.operationId,
      previewUrl: media.previewUrl
    }, payload.projectId);
  }
  async function generateI2vViaBatch(payload, requestId) {
    const prompt = (payload.prompt ?? "").trim();
    if (!prompt) throw bridgeError("INVALID_INPUT", "Image-to-Video requires a non-empty prompt.", false);
    if (!payload.startImage?.mediaId) {
      throw bridgeError("INVALID_INPUT", "Image-to-Video batch transport requires a start image mediaId.", false);
    }
    assertSingleBatchVideoSettingsSupported(payload, "Omni Image-to-Video");
    const tab = await findFlowTab(payload.projectId);
    if (!tab?.id) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const liveProjectId = projectIdFromUrl(tab.url ?? "");
    if (liveProjectId !== payload.projectId) {
      throw bridgeError(
        "PROJECT_MISMATCH",
        `Active Google Flow tab project (${liveProjectId || "none"}) does not match request projectId (${payload.projectId}).`,
        false
      );
    }
    throwIfGenerationAborted(requestId);
    const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.VIDEO);
    const fReq = buildFlowFirstFrameVideoRequest({
      prompt,
      projectId: payload.projectId,
      sourceMediaId: payload.startImage.mediaId,
      model: payload.modelKey,
      aspect: payload.aspectRatio ?? "16:9"
    }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);
    const result = await timeoutable(
      runFlowBatchPageRpc({
        tabId: tab.id,
        rpcId: FLOW_BATCH_RPC.GENERATE_VIDEO,
        fReq
      }),
      12e4
    );
    throwIfGenerationAborted(requestId);
    return completeOperationBackedBatchVideo(
      tab.id,
      payload,
      FLOW_BATCH_RPC.GENERATE_VIDEO,
      result.text,
      requestId
    );
  }
  async function generateInterpolationViaBatch(payload, requestId) {
    const prompt = (payload.prompt ?? "").trim();
    if (!prompt) throw bridgeError("INVALID_INPUT", "First+Last video requires a non-empty prompt.", false);
    if (!payload.startImage?.mediaId || !payload.endImage?.mediaId) {
      throw bridgeError("INVALID_INPUT", "First+Last batch transport requires both start and end image mediaIds.", false);
    }
    assertSingleBatchVideoSettingsSupported(payload, "Omni First+Last");
    const tab = await findFlowTab(payload.projectId);
    if (!tab?.id) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const liveProjectId = projectIdFromUrl(tab.url ?? "");
    if (liveProjectId !== payload.projectId) {
      throw bridgeError(
        "PROJECT_MISMATCH",
        `Active Google Flow tab project (${liveProjectId || "none"}) does not match request projectId (${payload.projectId}).`,
        false
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
      aspect: payload.aspectRatio ?? "16:9"
    }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);
    const result = await timeoutable(
      runFlowBatchPageRpc({
        tabId: tab.id,
        rpcId: FLOW_BATCH_RPC.GENERATE_VIDEO_FIRST_LAST,
        fReq
      }),
      12e4
    );
    throwIfGenerationAborted(requestId);
    return completeOperationBackedBatchVideo(
      tab.id,
      payload,
      FLOW_BATCH_RPC.GENERATE_VIDEO_FIRST_LAST,
      result.text,
      requestId
    );
  }
  async function generateReferenceVideoViaBatch(payload, requestId) {
    const prompt = (payload.prompt ?? "").trim();
    const referenceMediaIds = (payload.imageRefs ?? []).map((reference) => reference.mediaId).filter(Boolean);
    if (!prompt) throw bridgeError("INVALID_INPUT", "Reference Video requires a non-empty prompt.", false);
    if (!referenceMediaIds.length) {
      throw bridgeError("INVALID_INPUT", "Reference Video batch transport requires at least one reference mediaId.", false);
    }
    assertSingleBatchVideoSettingsSupported(payload, "Omni Reference Video");
    const tab = await findFlowTab(payload.projectId);
    if (!tab?.id) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const liveProjectId = projectIdFromUrl(tab.url ?? "");
    if (liveProjectId !== payload.projectId) {
      throw bridgeError(
        "PROJECT_MISMATCH",
        `Active Google Flow tab project (${liveProjectId || "none"}) does not match request projectId (${payload.projectId}).`,
        false
      );
    }
    throwIfGenerationAborted(requestId);
    const captchaToken = await recaptchaToken(payload.projectId, FLOW_BATCH_CAPTCHA_ACTION.VIDEO);
    const fReq = buildFlowReferenceVideoRequest({
      prompt,
      projectId: payload.projectId,
      referenceMediaIds,
      model: payload.modelKey,
      aspect: payload.aspectRatio ?? "16:9"
    }).split(FLOW_BATCH_CAPTCHA_SLOT).join(captchaToken);
    const result = await timeoutable(
      runFlowBatchPageRpc({
        tabId: tab.id,
        rpcId: FLOW_BATCH_RPC.GENERATE_VIDEO_REFERENCES,
        fReq
      }),
      12e4
    );
    throwIfGenerationAborted(requestId);
    return completeOperationBackedBatchVideo(
      tab.id,
      payload,
      FLOW_BATCH_RPC.GENERATE_VIDEO_REFERENCES,
      result.text,
      requestId
    );
  }
  async function pollFlowBatchMediaStatus(payload) {
    const tab = await findFlowTab(payload.projectId);
    if (!tab?.id) return void 0;
    const liveProjectId = projectIdFromUrl(tab.url ?? "");
    if (liveProjectId !== payload.projectId) return void 0;
    try {
      const result = await flowBatchPollerForTab(tab.id).pollMedia(
        payload.mediaId,
        payload.projectId
      );
      if (result.status === "SUCCESSFUL" && result.url) {
        return {
          status: "SUCCESSFUL",
          media: {
            mediaId: payload.mediaId,
            type: "VIDEO",
            projectId: payload.projectId,
            previewUrl: result.url
          }
        };
      }
      return {
        status: "ACTIVE"
      };
    } catch (error) {
      const normalized = toFlowBatchBridgeError(error);
      const code = String(normalized.code ?? "BATCH_RPC_UNAVAILABLE");
      return mayFallbackFromBatch(code) ? void 0 : {
        status: "FAILED",
        errorMessage: normalized.message
      };
    }
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
  async function generateApi(payload, requestId) {
    throwIfGenerationAborted(requestId);
    const token = await recaptchaToken(payload.projectId);
    throwIfGenerationAborted(requestId);
    const withToken = { ...payload, recaptchaToken: token };
    const body = buildRequestPayload(withToken);
    const json = await aisandboxFetch(endpointFor(payload), body);
    throwIfGenerationAborted(requestId);
    const media = json.media?.[0];
    if (!media?.name) throw bridgeError("MEDIA_FAILED", "Provider returned no media id", false);
    emitGenerateProgress(requestId, media.name);
    const imageFife = media.image?.generatedImage?.fifeUrl;
    const previewUrl = imageFife ? await resolveMediaUrl(media.name, "IMAGE").catch(() => imageFife) : void 0;
    const isImageOutput = payload.kind === "t2i" || payload.kind === "imageUpscale";
    return completeGenerate(requestId, {
      mediaId: media.name,
      type: isImageOutput ? "IMAGE" : "VIDEO",
      projectId: media.projectId ?? payload.projectId,
      workflowId: media.workflowId ?? json.workflows?.[0]?.name,
      previewUrl
    }, payload.projectId);
  }
  function emitGenerateProgress(requestId, mediaId) {
    if (!requestId || !mediaId) return;
    trackGenerationMedia(requestId, mediaId);
    try {
      void chrome.runtime.sendMessage({
        type: GENERATE_PROGRESS_TYPE,
        requestId,
        mediaId
      });
    } catch {
    }
  }
  async function completeGenerate(requestId, result, projectId) {
    emitGenerateProgress(requestId, result.mediaId);
    return finalizeGenerateAgainstAbort(requestId, result, (mediaId) => handleCancel({ projectId, mediaId }));
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
  }
  async function ensureFlowProjectComposerReady(tab, projectId, timeoutMs = 2e4) {
    if (tab.id === void 0) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const tabId = tab.id;
    const projectUrl = `https://flow.google.com/project/${projectId}`;
    let current = tab;
    if ((current.url ?? "").includes("/edit/")) {
      current = await chrome.tabs.update(tabId, { url: projectUrl });
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      current = await chrome.tabs.get(tabId);
      const liveProjectId = projectIdFromUrl(current.url ?? "");
      if (liveProjectId && liveProjectId !== projectId) {
        throw bridgeError(
          "PROJECT_MISMATCH",
          `Flow tab project ${liveProjectId} does not match generation project ${projectId}.`,
          false
        );
      }
      if ((current.url ?? "").includes(`/project/${projectId}`) && !(current.url ?? "").includes("/edit/")) {
        const ready = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]') || document.querySelector('.ProseMirror[contenteditable="true"]') || document.querySelector('[role="textbox"][contenteditable="true"]');
            const settings = document.querySelector("button.settings-trigger-button") || Array.from(document.querySelectorAll("button")).find((button) => {
              const aria = (button.getAttribute("aria-label") || "").toLowerCase();
              return button.getAttribute("aria-haspopup") === "menu" && (aria.includes("settings") || aria.includes("c\xE0i \u0111\u1EB7t") || /video|image/i.test(button.textContent || ""));
            });
            return Boolean(editor && settings);
          }
        }).then((results) => Boolean(results?.[0]?.result)).catch(() => false);
        if (ready) return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw bridgeError(
      "UI_NOT_READY",
      "Google Flow project composer did not become ready after leaving the media editor.",
      true
    );
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
      const clickAt = (x, y) => cdpClickAt(target, x, y);
      const editUrl = galleryUrl ? `${galleryUrl.replace(/\/edit\/[^/]+.*$/, "")}/edit/${mediaId}` : "";
      projectUrl = galleryUrl ? galleryUrl.replace(/\/edit\/[^/]+.*$/, "") : "";
      const downloadBtnXY = () => evalOnPage(
        `(()=>{const b=[...document.querySelectorAll('button')].find((x)=>{const a=(x.getAttribute('aria-label')||'').toLowerCase();const i=x.querySelector('mat-icon,i');return /download|t\u1EA3i/.test(a)||(i&&i.textContent.trim()==='download')||(x.innerText||'').trim()==='download'});if(!b)return null;const r=b.getBoundingClientRect();if(r.width<2)return null;return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
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
          const projectId = projectIdFromUrl(projectUrl);
          if (projectId) {
            await ensureFlowProjectComposerReady(current, projectId, 2e4);
          } else if ((current.url || "").includes("/edit/")) {
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
      if (!tab || tab.id === void 0) {
        return {
          state: "DISCONNECTED",
          error: "Ch\u1EC9 k\u1EBFt n\u1ED1i khi trang Google Flow \u0111ang m\u1EDF."
        };
      }
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
  async function detectFlowServiceTierFromUi() {
    try {
      const tab = await findFlowTab();
      if (!tab?.id) return void 0;
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const texts = Array.from(document.querySelectorAll("button, span, div, a")).map((element) => (element.textContent || "").replace(/\s+/g, " ").trim()).filter((text) => text.length > 0 && text.length <= 80);
          if (texts.some((text) => /(^|\s)ULTRA($|\s)/i.test(text))) return "SERVICE_TIER_ADVANCED";
          if (texts.some((text) => /(^|\s)PRO($|\s)/i.test(text))) return "SERVICE_TIER_INTERMEDIATE";
          return void 0;
        }
      });
      const inferred = results?.[0]?.result;
      return typeof inferred === "string" ? inferred : void 0;
    } catch {
      return void 0;
    }
  }
  async function handleCredits() {
    try {
      const tab = await findFlowTab();
      if (tab && tab.id !== void 0) {
        try {
          const injected = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const bodyText = document.body.innerText || "";
              const match = bodyText.match(/(?:credits?|điểm)\s*:?\s*(\d+)/i) || bodyText.match(/(\d+)\s*(?:credits?|điểm)/i);
              if (match) {
                const val = parseInt(match[1], 10);
                if (!isNaN(val)) return val;
              }
              return null;
            }
          });
          const domCredit = injected?.[0]?.result;
          if (typeof domCredit === "number") {
            const serviceTier2 = await detectFlowServiceTierFromUi();
            return { credits: domCredit, serviceTier: serviceTier2 };
          }
        } catch {
        }
      }
      let data = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await ensureSession();
        const response = await timeoutable(
          fetch(`${AISANDBOX_BASE}/credits`, { headers: bearerHeaders() }),
          REQUEST_TIMEOUT_MS
        );
        const parsed = await response.json().catch(() => ({}));
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
      if (!data) throw bridgeError("AUTH_EXPIRED", "Google Flow credits session could not be refreshed.", true);
      const credits = typeof data.credits === "number" ? data.credits : typeof data.remainingCredits === "number" ? data.remainingCredits : void 0;
      const serviceTier = typeof data.serviceTier === "string" ? data.serviceTier : await detectFlowServiceTierFromUi();
      return {
        credits,
        userPaygateTier: typeof data.userPaygateTier === "string" ? data.userPaygateTier : void 0,
        serviceTier
      };
    } catch (error) {
      const normalized = normalizeError(error);
      const serviceTier = await detectFlowServiceTierFromUi();
      return { error: normalized.message, serviceTier };
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
      settingWrites.push({ field: "durationSeconds", type: "FLOWGRAPH_SYNC_SET_DURATION", value: payload.durationSeconds });
    }
    if (payload.batchCount !== void 0 && Number.isFinite(payload.batchCount) && payload.batchCount >= 1) {
      settingWrites.push({ field: "batchCount", type: "FLOWGRAPH_SYNC_SET_BATCH", value: String(Math.min(4, Math.floor(payload.batchCount))) });
    }
    if (payload.targetResolution && isVideoKind(payload.kind)) {
      settingWrites.push({ field: "targetResolution", type: "FLOWGRAPH_SYNC_SET_RESOLUTION", value: payload.targetResolution });
    }
    if (payload.seed !== void 0 && Number.isInteger(payload.seed)) {
      settingWrites.push({ field: "seed", type: "FLOWGRAPH_SYNC_SET_SEED", value: payload.seed });
    }
    const promptWrite = payload.prompt === void 0 ? void 0 : { field: "prompt", type: "FLOWGRAPH_SYNC_SET_PROMPT", value: payload.prompt };
    const limitations = [];
    const scalarVerified = {};
    const scalarFixedByModel = {};
    const requestedScalars = {
      aspectRatio,
      durationSeconds: payload.durationSeconds,
      batchCount: payload.batchCount !== void 0 && Number.isFinite(payload.batchCount) && payload.batchCount >= 1 ? Math.min(4, Math.floor(payload.batchCount)) : void 0,
      targetResolution: payload.targetResolution && isVideoKind(payload.kind) ? payload.targetResolution : void 0,
      seed: payload.seed !== void 0 && Number.isInteger(payload.seed) ? payload.seed : void 0
    };
    const applyWrites = async (writes) => {
      for (const write of writes) {
        const syncId = `preflight-${write.field}-${crypto.randomUUID()}`;
        const startedAt = Date.now();
        if (write.type === "FLOWGRAPH_SYNC_SET_MODEL") {
          await bindRealtimeModel(tab, String(write.value ?? ""));
          console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
            syncId,
            projectId: payload.projectId
          });
          continue;
        }
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
        ).catch(() => void 0);
        if (reply?.ok) {
          if (isCostScalarField(write.field)) scalarVerified[write.field] = true;
          console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
            syncId,
            projectId: payload.projectId
          });
          continue;
        }
        if (shouldToleratePreflightFailure(write, reply)) {
          if (isCostScalarField(write.field) && reply?.code === "NO_UI_COUNTERPART") {
            scalarFixedByModel[write.field] = true;
          }
          limitations.push(write.field);
          console.info(`[FlowGraph Sync] ${write.field} PREFLIGHT tolerated fallback ${Date.now() - startedAt}ms`, {
            syncId,
            projectId: payload.projectId,
            reply
          });
          continue;
        }
        throw bridgeError(
          preflightFailureCode(write, reply),
          reply?.message ?? `Google Flow did not verify ${write.field} before Generate.`,
          false
        );
      }
    };
    try {
      await applyWrites([modeWrite]);
    } catch (err) {
      console.warn("[FlowGraph Sync] modeWrite preflight failed; verifying with direct CDP switch:", err);
    }
    await bindRealtimeMode(tab, modeWrite.value);
    if (payload.kind === "t2v") {
      await clearRealtimeFrameBindings(tab, ["startImage", "endImage"]);
    } else if (payload.kind === "i2v") {
      await clearRealtimeFrameBindings(tab, ["endImage"]);
    }
    if (payload.startImage?.mediaId) {
      const startedAt = Date.now();
      try {
        await bindRealtimeStartImage(tab, payload.startImage.mediaId);
        console.info(`[FlowGraph Sync] startImage PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
          projectId: payload.projectId
        });
      } catch (err) {
        if (shouldFailClosedOnMediaBindFailure(payload.kind, "startImage")) throw err;
        console.warn("[FlowGraph Sync] startImage preflight warning, proceeding with generation:", err);
      }
    }
    if (payload.endImage?.mediaId) {
      const startedAt = Date.now();
      await bindRealtimeEndImage(tab, payload.endImage.mediaId);
      console.info(`[FlowGraph Sync] endImage PREFLIGHT SUCCESS ${Date.now() - startedAt}ms`, {
        projectId: payload.projectId
      });
    }
    if (payload.kind !== "imageUpscale" && payload.imageRefs && payload.imageRefs.length > 0) {
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
    const assertScalarReadyToSubmit = async () => {
      await applyWrites(settingWrites);
      if (!canSubmitGenerateWithScalarSettings({
        requested: requestedScalars,
        verified: scalarVerified,
        fixedByModel: scalarFixedByModel
      })) {
        throw bridgeError(
          "INVALID_INPUT",
          "Requested generation settings were not verified on the Flow composer. Generation aborted.",
          false
        );
      }
    };
    return { limitations, assertScalarReadyToSubmit };
  }
  async function generateImageUpscaleViaFlowUi(tab, payload, requestId) {
    const tabId = tab.id;
    if (tabId === void 0) throw bridgeError("NO_FLOW_TAB", "No Google Flow tab is open.", false);
    const mediaId = payload.imageRefs?.[0]?.mediaId || payload.mediaId;
    if (!mediaId) throw bridgeError("INVALID_INPUT", "imageUpscale requires an image mediaId", false);
    const targetResolution = payload.targetResolution === "UPSAMPLE_IMAGE_RESOLUTION_4K" || payload.targetResolution === "4K" ? "4K" : "2K";
    const projectUrl = `https://flow.google.com/project/${payload.projectId}`;
    const editorUrl = `${projectUrl}/edit/${mediaId}`;
    const target = { tabId };
    let attachedHere = false;
    try {
      try {
        await chrome.debugger.attach(target, "1.3");
        attachedHere = true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!/already attached/i.test(msg)) throw bridgeError("UI_NOT_READY", `Could not attach debugger for image upscale: ${msg}`, true);
      }
      await ensureInputReachable(target);
      const evaluate = async (expression) => {
        const res = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true
        });
        return res?.result?.value;
      };
      const waitFor = async (fn, predicate, ms) => {
        const deadline = Date.now() + ms;
        for (; ; ) {
          const value = await fn();
          if (predicate(value)) return value;
          if (Date.now() > deadline) return value;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      };
      const escape = async () => {
        await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {
        });
        await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {
        });
      };
      throwIfGenerationAborted(requestId);
      const here = await evaluate("location.href");
      if (!(here || "").includes(`/edit/${mediaId}`)) {
        await chrome.debugger.sendCommand(target, "Page.navigate", { url: editorUrl });
      }
      const downloadReady = await waitFor(
        () => evaluate(`!![...document.querySelectorAll('button')].find((b)=>(b.getAttribute('aria-label')||'')==='T\u1EA3i n\u1ED9i dung nghe nh\xECn xu\u1ED1ng'||/download/i.test(b.getAttribute('aria-label')||''))`),
        Boolean,
        2e4
      );
      if (!downloadReady) throw bridgeError("UI_NOT_READY", "Flow image editor download action was not available.", true);
      const before = await chrome.downloads.search({});
      const beforeIds = new Set(before.map((item) => item.id));
      await escape();
      const opened = await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find((x)=>(x.getAttribute('aria-label')||'')==='T\u1EA3i n\u1ED9i dung nghe nh\xECn xu\u1ED1ng'||/download/i.test(x.getAttribute('aria-label')||''));if(!b)return false;b.click();return true})()`);
      if (!opened) throw bridgeError("UI_NOT_READY", "Could not open Flow image download menu.", true);
      const optionReady = await waitFor(
        () => evaluate(`!![...document.querySelectorAll('[role="menuitem"],button')].find((x)=>new RegExp('^${targetResolution}(?:\\\\s|$)','i').test((x.innerText||x.textContent||'').replace(/\\\\s+/g,' ').trim()))`),
        Boolean,
        5e3
      );
      if (!optionReady) throw bridgeError("UI_NOT_READY", `Flow ${targetResolution} image upscale option was not available.`, true);
      const clicked = await evaluate(`(()=>{const x=[...document.querySelectorAll('[role="menuitem"],button')].find((el)=>/^${targetResolution}(?:\\s|$)/i.test((el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim()));if(!x)return false;x.click();return true})()`);
      if (!clicked) throw bridgeError("UI_NOT_READY", `Could not select Flow ${targetResolution} image upscale.`, true);
      let downloaded;
      const downloadDeadline = Date.now() + 9e4;
      while (Date.now() <= downloadDeadline) {
        throwIfGenerationAborted(requestId);
        const items = await chrome.downloads.search({});
        downloaded = items.filter((item) => !beforeIds.has(item.id)).find((item) => item.state === "complete" && new RegExp(`_${targetResolution}_`, "i").test(item.filename || ""));
        if (downloaded?.filename) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (!downloaded?.filename) throw bridgeError("MEDIA_FAILED", `Flow ${targetResolution} image upscale download did not complete.`, true);
      await chrome.debugger.sendCommand(target, "Page.navigate", { url: projectUrl });
      const composerReady = await waitFor(
        () => evaluate(`!!document.querySelector('button.add-menu-trigger')`),
        Boolean,
        2e4
      );
      if (!composerReady) throw bridgeError("UI_NOT_READY", "Flow project composer did not recover after image upscale.", true);
      for (let i = 0; i < 3; i += 1) await escape();
      const pickerOpened = await evaluate(`(()=>{const b=document.querySelector('button.add-menu-trigger');if(!b)return false;b.click();return true})()`);
      if (!pickerOpened) throw bridgeError("UI_NOT_READY", "Flow media picker could not be opened for the upscaled image.", true);
      const uploadReady = await waitFor(
        () => evaluate(`!!document.querySelector('button.sidebar-upload-btn')`),
        Boolean,
        12e3
      );
      if (!uploadReady) throw bridgeError("UI_NOT_READY", "Flow media upload action was not available.", true);
      const uploadClicked = await evaluate(`(()=>{const b=document.querySelector('button.sidebar-upload-btn');if(!b)return false;b.click();return true})()`);
      if (!uploadClicked) throw bridgeError("UI_NOT_READY", "Could not open Flow upload file picker.", true);
      const inputObject = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression: `document.querySelector('input[type="file"]')`,
        returnByValue: false
      });
      const objectId = inputObject?.result?.objectId;
      if (!objectId) throw bridgeError("UI_NOT_READY", "Flow upload file input was not available.", true);
      await chrome.debugger.sendCommand(target, "DOM.setFileInputFiles", { files: [downloaded.filename], objectId });
      const consent = await waitFor(
        () => evaluate(`(()=>{const d=[...document.querySelectorAll('[role="dialog"],mat-dialog-container')].find((x)=>/Quy\u1EC1n s\u1EED d\u1EE5ng h\xECnh \u1EA3nh n\xE0y|rights to this image|I agree|T\xF4i \u0111\u1ED3ng \xFD/i.test(x.innerText||''));if(d)return 'CONSENT';const picker=[...document.querySelectorAll('.cdk-overlay-pane')].find((x)=>x.querySelector('.asset-list-viewport'));return picker?'READY':''})()`),
        (value) => value === "CONSENT" || value === "READY",
        5e3
      );
      if (consent === "CONSENT") {
        throw bridgeError(
          "USER_ACTION_REQUIRED",
          "Google Flow requires a one-time image-rights confirmation. Open the Flow tab, review the dialog, choose \u201CT\xF4i \u0111\u1ED3ng \xFD\u201D if appropriate, then retry the workflow.",
          false
        );
      }
      const fileName = downloaded.filename.split(/[\\/]/).pop() || "";
      const stem = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      const uploadedId = await waitFor(
        () => evaluate(`(()=>{const uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;const candidates=[...document.querySelectorAll('.asset-item')];const stem=${JSON.stringify(stem.toLowerCase())};const row=candidates.find((x)=>((x.innerText||'').toLowerCase().includes(stem.slice(0,Math.min(28,stem.length))))||((x.getAttribute('aria-label')||'').toLowerCase().includes(stem.slice(0,Math.min(28,stem.length)))))||candidates[0];if(!row)return '';const raw=[row.outerHTML,...[...row.querySelectorAll('*')].flatMap((el)=>[el.getAttribute?.('data-media-id'),el.getAttribute?.('src'),el.getAttribute?.('href')])].filter(Boolean).join(' ');return raw.match(uuid)?.[0]||''})()`),
        (value) => typeof value === "string" && value.length > 0,
        2e4
      );
      if (!uploadedId) {
        throw bridgeError("MEDIA_FAILED", "Upscaled image was uploaded, but FlowGraph could not resolve its new media id.", true);
      }
      const previewUrl = await resolveRedirectSafe(uploadedId, "IMAGE");
      return completeGenerate(requestId, {
        mediaId: uploadedId,
        type: "IMAGE",
        projectId: payload.projectId,
        previewUrl: previewUrl || void 0,
        fileName,
        mimeType: "image/jpeg"
      }, payload.projectId);
    } finally {
      if (attachedHere) {
        await chrome.debugger.detach(target).catch(() => {
        });
      }
    }
  }
  async function handleGenerate(payload, requestId) {
    throwIfGenerationAborted(requestId);
    const tab = await findFlowTab(payload.projectId);
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
    if (payload.kind === "imageUpscale") {
      return generateImageUpscaleViaFlowUi(tab, payload, requestId);
    }
    const isDirectApiPath = payload.kind === "videoUpscale" || payload.kind === "upscale";
    if (isDirectApiPath) {
      return generateApi(payload, requestId);
    }
    const capabilityRoute = resolveFlowCapabilityRoute(payload);
    if (payload.kind === "t2i" && capabilityRoute.primary === "BATCH_RPC") {
      try {
        return await generateT2iViaBatch(payload, requestId);
      } catch (error) {
        const batchError = toFlowBatchBridgeError(error);
        const code = String(batchError.code ?? "BATCH_RPC_UNAVAILABLE");
        if (capabilityRoute.fallback !== "FLOW_UI" || !mayFallbackFromBatch(code)) {
          throw batchError;
        }
        console.warn(
          `[FlowGraph] Batch T2I unavailable (${code}); falling back to verified Flow UI transport.`
        );
      }
    }
    if (payload.kind === "t2v" && capabilityRoute.primary === "BATCH_RPC") {
      try {
        return await generateT2vViaBatch(payload, requestId);
      } catch (error) {
        const batchError = toFlowBatchBridgeError(error);
        recordBatchDiagnostic("t2v", batchError);
        const code = String(batchError.code ?? "BATCH_RPC_UNAVAILABLE");
        if (capabilityRoute.fallback !== "FLOW_UI" || !mayFallbackFromBatch(code)) {
          throw batchError;
        }
        console.warn(
          `[FlowGraph] Batch Omni T2V unavailable (${code}); falling back to verified Flow UI transport.`
        );
      }
    }
    if (payload.kind === "i2v" && capabilityRoute.primary === "BATCH_RPC") {
      try {
        return await generateI2vViaBatch(payload, requestId);
      } catch (error) {
        const batchError = toFlowBatchBridgeError(error);
        recordBatchDiagnostic("i2v", batchError);
        const code = String(batchError.code ?? "BATCH_RPC_UNAVAILABLE");
        if (capabilityRoute.fallback !== "FLOW_UI" || !mayFallbackFromBatch(code)) {
          throw batchError;
        }
        console.warn(
          `[FlowGraph] Batch Omni I2V unavailable (${code}); falling back to verified Flow UI transport.`
        );
      }
    }
    if (payload.kind === "interpolation" && capabilityRoute.primary === "BATCH_RPC") {
      try {
        return await generateInterpolationViaBatch(payload, requestId);
      } catch (error) {
        const batchError = toFlowBatchBridgeError(error);
        recordBatchDiagnostic("interpolation", batchError);
        const code = String(batchError.code ?? "BATCH_RPC_UNAVAILABLE");
        if (capabilityRoute.fallback !== "FLOW_UI" || !mayFallbackFromBatch(code)) {
          throw batchError;
        }
        console.warn(
          `[FlowGraph] Batch Omni First+Last unavailable (${code}); falling back to verified Flow UI transport.`
        );
      }
    }
    if (payload.kind === "reference" && capabilityRoute.primary === "BATCH_RPC") {
      try {
        return await generateReferenceVideoViaBatch(payload, requestId);
      } catch (error) {
        const batchError = toFlowBatchBridgeError(error);
        recordBatchDiagnostic("reference", batchError);
        const code = String(batchError.code ?? "BATCH_RPC_UNAVAILABLE");
        if (capabilityRoute.fallback !== "FLOW_UI" || !mayFallbackFromBatch(code)) {
          throw batchError;
        }
        console.warn(
          `[FlowGraph] Batch Omni Reference Video unavailable (${code}); falling back to verified Flow UI transport.`
        );
      }
    }
    const composerTab = await ensureFlowProjectComposerReady(tab, payload.projectId);
    await ensureFlowContentScript(tabId);
    const prompt = (payload.prompt ?? (payload.kind === "videoUpscale" || payload.kind === "upscale" ? "High quality detailed upscale" : "")).trim();
    if (!prompt) {
      throw bridgeError(
        "INVALID_INPUT",
        `Refusing to generate: the ${payload.kind ?? "unknown"} node produced an empty prompt. Connect a Prompt node (or set a prompt on the node) instead of letting the UI fall back to a placeholder.`,
        false
      );
    }
    const galleryUrl = (composerTab.url ?? tab.url ?? "").replace(/\/edit\/[0-9a-zA-Z_-]+.*$/, "");
    const target = { tabId };
    let attached = false;
    let attachFailure = "";
    const { assertScalarReadyToSubmit } = await syncAndVerifyBeforeGenerate(composerTab, { ...payload, prompt });
    throwIfGenerationAborted(requestId);
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
      const clickAt = (x, y) => cdpClickAt(target, x, y, 80, requestId);
      const setComposerMode = async (kind) => {
        const wantVideo = isVideoKind(kind);
        const currentStatus = await evalOnPage(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        const text = btn ? (btn.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase() : '';
        const isVideo = text.includes('video') || text.includes('veo') || text.includes('omni');
        return { isVideo, text };
      })()`);
        if (canSubmitGenerateWithComposerMode({ kind, liveChipText: currentStatus?.text })) {
          return currentStatus?.text ?? "";
        }
        const triggerCoords = await evalOnPage(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        if (!btn) return { ok: false };
        const rect = btn.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
        if (triggerCoords?.ok && triggerCoords.x !== void 0 && triggerCoords.y !== void 0) {
          await clickAt(triggerCoords.x, triggerCoords.y);
          await waitWhileNotAborted(400, requestId);
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
          await waitWhileNotAborted(400, requestId);
        }
        await evalOnPage(`(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      })()`);
        await waitWhileNotAborted(200, requestId);
        const after = await evalOnPage(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        const text = btn ? (btn.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase() : '';
        const isVideo = text.includes('video') || text.includes('veo') || text.includes('omni');
        return { isVideo, text };
        })()`);
        if (!canSubmitGenerateWithComposerMode({ kind, liveChipText: after?.text })) {
          throw bridgeError(
            "INVALID_INPUT",
            `Composer mode does not match ${wantVideo ? "video" : "image"} (chip: ${after?.text || "none"}). Generation aborted.`,
            false
          );
        }
        return after?.text ?? "";
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
        throwIfGenerationAborted(requestId);
        await clickAt(pos.x, pos.y);
        for (let k = 0; k < 15; k += 1) {
          throwIfGenerationAborted(requestId);
          await waitWhileNotAborted(400, requestId);
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
            await waitWhileNotAborted(500, requestId);
          }
          return '';
        })()`) ?? "";
          await chrome.debugger.sendCommand(target, "Page.navigate", { url: galleryUrl }).catch(() => {
          });
          await waitWhileNotAborted(3e3, requestId);
          return { mediaId: m[1], editorPrompt };
        }
        await chrome.debugger.sendCommand(target, "Page.navigate", { url: galleryUrl }).catch(() => {
        });
        await waitWhileNotAborted(3e3, requestId);
        return void 0;
      };
      try {
        const beforeIds = await readMediaIds() ?? [];
        const beforeVidTokens = await readVideoPosterTokens() ?? [];
        throwIfGenerationAborted(requestId);
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
          await waitWhileNotAborted(500, requestId);
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
          await waitWhileNotAborted(600, requestId);
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
          await waitWhileNotAborted(900, requestId);
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
        let safePrompt = truncateFlowPrompt(prompt);
        const normalizedPrompt = expectedSubmittedPrompt(prompt);
        const readComposerText = async () => String(await evalOnPage(`(() => {
        const ed = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
          || document.querySelector('.ProseMirror[contenteditable="true"]')
          || document.querySelector('[role="textbox"][contenteditable="true"]');
        return ed?.innerText || ed?.textContent || '';
      })()`) ?? "");
        let promptCommitted = composerPromptMatchesExpected(await readComposerText(), normalizedPrompt);
        const assertPromptReadyToSubmit = async () => {
          throwIfGenerationAborted(requestId);
          if (!composerPromptMatchesExpected(await readComposerText(), normalizedPrompt)) {
            throw bridgeError(
              "INVALID_INPUT",
              "Composer prompt does not match the submitted prompt. Generation aborted.",
              false
            );
          }
        };
        const assertModeReadyToSubmit = async () => {
          throwIfGenerationAborted(requestId);
          const chip = String(await evalOnPage(`(() => {
          const btn = document.querySelector('button.settings-trigger-button');
          return btn ? (btn.innerText || '').replace(/\\s+/g, ' ').trim() : '';
        })()`) ?? "");
          if (!canSubmitGenerateWithComposerMode({ kind: payload.kind, liveChipText: chip })) {
            throw bridgeError(
              "INVALID_INPUT",
              `Composer mode does not match ${payload.kind} (chip: ${chip || "none"}). Generation aborted.`,
              false
            );
          }
        };
        const assertModelReadyToSubmit = async () => {
          throwIfGenerationAborted(requestId);
          if (!payload.modelLabel) return;
          await bindRealtimeModel(tab, payload.modelLabel);
          throwIfGenerationAborted(requestId);
        };
        const assertMediaReadyToSubmit = async () => {
          throwIfGenerationAborted(requestId);
          if (payload.kind === "interpolation") {
            const startId = payload.startImage?.mediaId;
            const endId = payload.endImage?.mediaId;
            const startSources = startId ? await evalOnPage(`((mediaId) => {
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
              })(${JSON.stringify(startId)})`) ?? [] : [];
            const endSources = endId ? await evalOnPage(`((mediaId) => {
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
              })(${JSON.stringify(endId)})`) ?? [] : [];
            const startBound = !startId || slotSourcesContainExactMediaId(startSources, startId);
            const endBound = !endId || slotSourcesContainExactMediaId(endSources, endId);
            if (!canSubmitGenerateWithMediaBindings({
              kind: "interpolation",
              hasStart: Boolean(startId),
              hasEnd: Boolean(endId),
              startBound,
              endBound
            })) {
              throw bridgeError(
                "MEDIA_FAILED",
                `Interpolation frames were not verified before Generate (start ${startId ?? "none"} bound=${startBound}, end ${endId ?? "none"} bound=${endBound}).`,
                false
              );
            }
          }
          if (payload.kind === "reference" && payload.imageRefs && payload.imageRefs.length > 0) {
            const expected = payload.imageRefs.map((ref) => ref.mediaId);
            const applied = await evalOnPage(`(() => {
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
              kind: "reference",
              hasRefs: true,
              referenceBound
            })) {
              throw bridgeError(
                "MEDIA_FAILED",
                `Flow Reference Media was not verified before Generate (requested ${expected.join(", ")}, bound ${applied.join(", ")}).`,
                false
              );
            }
          }
        };
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
            await waitWhileNotAborted(200, requestId);
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
            await waitWhileNotAborted(80, requestId);
            await chrome.debugger.sendCommand(target, "Input.insertText", { text: safePrompt });
            await waitWhileNotAborted(400, requestId);
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
        const promptDeadline = Date.now() + 4e3;
        while (Date.now() < promptDeadline) {
          promptCommitted = composerPromptMatchesExpected(await readComposerText(), normalizedPrompt);
          if (promptCommitted) break;
          await waitWhileNotAborted(150, requestId);
        }
        if (!promptCommitted) {
          await assertPromptReadyToSubmit();
        }
        await waitWhileNotAborted(1200, requestId);
        let generateButton = null;
        for (let attempt = 0; attempt < 12; attempt++) {
          throwIfGenerationAborted(requestId);
          generateButton = await evalOnPage(`(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const gen = buttons.find((button) => {
            const aria = (button.getAttribute('aria-label') || '').trim().toLowerCase();
            if (button.classList.contains('generate-icon-button')
              || /b\u1EAFt \u0111\u1EA7u t\u1EA1o|start creat|begin creat/.test(aria)) {
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
        if (!generateButton?.ok || generateButton.x === void 0 || generateButton.y === void 0) {
          throw bridgeError(
            "INVALID_INPUT",
            `Google Flow Generate button is not ready (${generateButton?.reason ?? "unknown"}).`,
            true
          );
        }
        throwIfGenerationAborted(requestId);
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
        const clickAtCenter = (x, y) => cdpClickAt(target, x, y, 80, requestId);
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
          throwIfGenerationAborted(requestId);
          if (attempt > 0) await waitWhileNotAborted(1500, requestId);
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
              submitTrace.push(`a${attempt}s${settle}:${consumed === void 0 ? "EVAL_UNDEF" : consumed ? "CONSUMED" : "TYPED"}{${snap ?? "noeval"}}`);
            }
            if (consumed) submitAccepted = true;
          }
          if (!submitAccepted) {
            await assertScalarReadyToSubmit();
            await assertModeReadyToSubmit();
            await assertModelReadyToSubmit();
            await assertMediaReadyToSubmit();
            await assertPromptReadyToSubmit();
            await clickAtCenter(fresh.x, fresh.y - 60);
            await waitWhileNotAborted(300, requestId);
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
              throwIfGenerationAborted(requestId);
              await waitWhileNotAborted(500, requestId);
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
          await waitWhileNotAborted(4e3, requestId);
          throwIfGenerationAborted(requestId);
          const elapsed = Date.now() - startMs;
          waitTick += 1;
          if (!wantVideo) {
            const current = await readMediaIds() ?? [];
            const newIds = current.filter((id) => !initialSet.has(id));
            if (newIds.length > 0) {
              const candidates = [];
              for (const candidateId of newIds.slice(0, 4)) {
                const text = await evalOnPage(`((id) => {
                const el = Array.from(document.querySelectorAll('img, [data-media-id]')).find((candidate) => {
                  const src = String(candidate.getAttribute('src') || candidate.src || '');
                  const attr = String(candidate.getAttribute('data-media-id') || '');
                  return attr === id || src.includes(id);
                });
                const tile = el?.closest('[role="button"]') || el?.parentElement;
                return tile ? (tile.innerText || '').replace(/\\s+/g, ' ').trim() : '';
              })(${JSON.stringify(candidateId)})`) ?? "";
                const matchedPrompt = editorPromptMatches(text, prompt);
                candidates.push({ mediaId: candidateId, editorPrompt: text, matchedPrompt });
              }
              const attributedId = selectAttributedImageMediaId({ candidates, expectedPrompt: prompt });
              if (attributedId) {
                emitGenerateProgress(requestId, attributedId);
                const previewUrl2 = await resolveRedirectSafe(attributedId, "IMAGE");
                return completeGenerate(requestId, { mediaId: attributedId, type: "IMAGE", projectId: payload.projectId, previewUrl: previewUrl2, completedViaUi: true }, payload.projectId);
              }
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
          const previewUrl = await resolveRedirectSafe(matched.mediaId, "VIDEO");
          emitGenerateProgress(requestId, matched.mediaId);
          return completeGenerate(requestId, { mediaId: matched.mediaId, type: "VIDEO", projectId: payload.projectId, previewUrl, completedViaUi: true }, payload.projectId);
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
    throwIfGenerationAborted(requestId);
    if (shouldFailClosedWhenDebuggerUnavailable(attached)) {
      throw bridgeError(
        "UI_NOT_READY",
        `Chrome debugger is unavailable; generation aborted without a Generate click${attachFailure ? `: ${attachFailure}` : ""}.`,
        false
      );
    }
    throw bridgeError(
      "UI_NOT_READY",
      "Chrome debugger is unavailable; generation aborted without a Generate click.",
      false
    );
  }
  async function handleMediaStatus(payload) {
    if (payload.playbackRecovery) {
      const tab = await findFlowTab();
      if (tab?.id === void 0) return { status: "FAILED" };
      const tabPath = (() => {
        try {
          return new URL(tab.url || "").pathname;
        } catch {
          return "";
        }
      })();
      const exactProjectActive = tabPath.split("/").includes(payload.projectId);
      if (!/^[0-9a-f-]{36}$/i.test(payload.mediaId) || !exactProjectActive) {
        return {
          status: "FAILED",
          errorMessage: "Playback recovery requires the exact provider video in its active Flow project."
        };
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [payload.mediaId, payload.projectId],
        func: (id, projectId) => {
          if (!/^[0-9a-f-]{36}$/i.test(id) || !location.pathname.split("/").includes(projectId)) return null;
          const exactTile = document.querySelector(`[data-media-id="${id}"]`);
          const candidates = exactTile ? Array.from(exactTile.querySelectorAll("video")) : location.pathname.endsWith(`/edit/${id}`) ? Array.from(document.querySelectorAll("video")) : [];
          if (candidates.length !== 1) return null;
          const video = candidates[0];
          if (video.error || video.readyState < 2 || !video.currentSrc) return null;
          return video.currentSrc;
        }
      });
      const passiveUrl = results[0]?.result;
      if (typeof passiveUrl === "string" && passiveUrl) {
        return {
          status: "SUCCESSFUL",
          media: { mediaId: payload.mediaId, projectId: payload.projectId, type: "VIDEO", previewUrl: passiveUrl }
        };
      }
      if (payload.playbackRefresh === true) {
        try {
          const refreshedUrl = await timeoutable(
            resolveVideoUrlViaDebugger(tab.id, tab.url, payload.mediaId),
            DOWNLOAD_RESOLVE_BUDGET_MS
          );
          if (refreshedUrl) {
            return {
              status: "SUCCESSFUL",
              media: { mediaId: payload.mediaId, projectId: payload.projectId, type: "VIDEO", previewUrl: refreshedUrl }
            };
          }
        } catch {
        }
      }
      return {
        status: "FAILED",
        errorMessage: payload.playbackRefresh ? "Could not refresh the exact video source from Flow." : "Exact video is not playable on the Flow page. Retry to refresh this exact clip."
      };
    }
    const batchStatus = await pollFlowBatchMediaStatus(payload);
    if (batchStatus) return batchStatus;
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
  async function uploadImageViaFlowTab(body) {
    const tab = await findFlowTab();
    if (!tab || tab.id === void 0) throw bridgeError("NO_FLOW_TAB", "Open Google Flow first.", false);
    const results = await timeoutable(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [`${AISANDBOX_BASE}/flow/uploadImage`, body],
        func: async (url, payload) => {
          const response = await fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const text = await response.text();
          return { status: response.status, text };
        }
      }),
      REQUEST_TIMEOUT_MS
    );
    const reply = results[0]?.result;
    if (!reply) throw bridgeError("PROVIDER_ERROR", "Flow tab did not accept the upload.", true);
    let json = null;
    try {
      json = JSON.parse(reply.text || "");
    } catch {
    }
    if (!reply.status || reply.status >= 400) throw providerError(reply.status || 0, json);
    return json;
  }
  async function handleMediaUpload(payload) {
    const body = buildUploadRequest(
      payload.projectId,
      payload.imageBytesBase64,
      payload.mimeType,
      payload.fileName
    );
    let json;
    try {
      json = await uploadImageViaFlowTab(body);
    } catch (error) {
      const code = error.code;
      if (code === "NO_FLOW_TAB" || code === "AUTH_EXPIRED") throw error;
      json = await aisandboxFetch("flow/uploadImage", body);
    }
    const mediaObj = Array.isArray(json.media) ? json.media[0] : json.media;
    const mediaName = mediaObj?.name || json.workflow?.metadata?.primaryMediaId;
    if (!mediaName) throw bridgeError("MEDIA_FAILED", "Upload returned no media id", false);
    return {
      mediaId: mediaName,
      type: "IMAGE",
      projectId: mediaObj?.projectId ?? payload.projectId,
      workflowId: mediaObj?.workflowId ?? json.workflow?.name,
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
        case "FLOWGRAPH_ABORT_GENERATE": {
          const abortPayload = request.payload;
          const targetId = abortPayload?.requestId || request.requestId;
          markGenerationAborted(targetId);
          const flight = getGenerationFlight(targetId);
          if (flight?.mediaId && flight.projectId) {
            await handleCancel({ projectId: flight.projectId, mediaId: flight.mediaId }).catch(() => void 0);
          }
          return makeResponse(request.requestId, { aborted: true, requestId: targetId });
        }
        case "FLOWGRAPH_GENERATE_PROGRESS":
          return makeResponse(request.requestId, { ok: true });
        case "FLOWGRAPH_GENERATE": {
          const genPayload = request.payload;
          const isDirectApiPath = genPayload.kind === "videoUpscale";
          trackGenerationStart(request.requestId, genPayload.projectId);
          try {
            if (isGenerationAborted(request.requestId)) {
              return makeError(request.requestId, "CANCELLED", "Generation aborted", false);
            }
            const data = isDirectApiPath ? await generateApi(genPayload, request.requestId) : await handleGenerate(genPayload, request.requestId);
            if (data?.mediaId) emitGenerateProgress(request.requestId, data.mediaId);
            if (isGenerationAborted(request.requestId)) {
              if (data?.mediaId) {
                await handleCancel({ projectId: genPayload.projectId, mediaId: data.mediaId }).catch(() => void 0);
              }
              return makeError(request.requestId, "CANCELLED", "Generation aborted", false);
            }
            return makeResponse(request.requestId, data);
          } finally {
            endGeneration(request.requestId);
          }
        }
        case "FLOWGRAPH_MEDIA_STATUS":
          return makeResponse(request.requestId, await handleMediaStatus(request.payload));
        case "FLOWGRAPH_MEDIA_DOWNLOAD":
          return makeResponse(request.requestId, await downloadMedia(request.payload));
        case "FLOWGRAPH_CANCEL":
          return makeResponse(request.requestId, await handleCancel(request.payload));
        case "FLOWGRAPH_PROXY_FETCH": {
          const payload = request.payload;
          const target = new URL(payload.url);
          const hostname = target.hostname.toLowerCase();
          const isLocalGateway = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
          if (target.protocol !== "http:" && target.protocol !== "https:" || !isLocalGateway && !PROXY_FETCH_ALLOWED_HOSTS.has(hostname)) {
            return makeError(request.requestId, "FORBIDDEN", `Proxy fetch blocked for non-allowlisted host: ${target.hostname}`, false);
          }
          const response = await fetch(target.toString(), {
            method: payload.method || "GET",
            headers: payload.headers,
            body: payload.body
          });
          const text = await response.text();
          return makeResponse(request.requestId, {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            text
          });
        }
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
  var activeProviderFocusActivities = /* @__PURE__ */ new Map();
  var FOCUS_TELEMETRY_REQUEST_TYPES = /* @__PURE__ */ new Set([
    "FLOWGRAPH_PROJECT_SELECT",
    "FLOWGRAPH_MEDIA_UPLOAD",
    "FLOWGRAPH_MEDIA_STATUS",
    "FLOWGRAPH_MEDIA_DOWNLOAD",
    "FLOWGRAPH_GENERATE"
  ]);
  function focusTelemetryAction(type) {
    if (type.startsWith("FLOWGRAPH_SYNC_")) {
      return `sync:${type.replace(/^FLOWGRAPH_SYNC_/, "").toLowerCase()}`;
    }
    return type.replace(/^FLOWGRAPH_/, "").toLowerCase().replaceAll("_", ":");
  }
  async function withProviderFocusTelemetry(action, requestId, sender, task) {
    const provider = await findFlowTab().catch(() => void 0);
    const sourceTab = sender.tab;
    const activity = {
      id: crypto.randomUUID(),
      action,
      requestId,
      startedAt: Date.now(),
      sourceTabId: sourceTab?.id,
      sourceWindowId: sourceTab?.windowId,
      sourceUrl: sourceTab?.url,
      providerTabId: provider?.id,
      providerWindowId: provider?.windowId,
      reported: false
    };
    activeProviderFocusActivities.set(activity.id, activity);
    try {
      return await task();
    } finally {
      activeProviderFocusActivities.delete(activity.id);
    }
  }
  async function emitFocusTelemetry(activity, activatedTabId) {
    const durationMs = Math.max(0, Date.now() - activity.startedAt);
    const payload = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      code: "SUSPECTED_FOCUS_STEAL",
      action: activity.action,
      requestId: activity.requestId,
      durationMs,
      fromTabId: activity.sourceTabId,
      toTabId: activatedTabId,
      providerTabId: activity.providerTabId,
      windowId: activity.providerWindowId ?? activity.sourceWindowId,
      message: `Google Flow became the active tab while automatic provider action "${activity.action}" was running.`
    };
    console.warn("[FlowGraph Focus Telemetry]", payload);
    await chrome.runtime.sendMessage({
      type: "FLOWGRAPH_FOCUS_TELEMETRY",
      requestId: `sw:focus:${activity.id}`,
      payload
    }).catch(() => {
    });
  }
  chrome.tabs.onActivated.addListener((activeInfo) => {
    for (const activity of activeProviderFocusActivities.values()) {
      if (activity.reported) continue;
      if (activity.providerTabId === void 0 || activeInfo.tabId !== activity.providerTabId) continue;
      if (activity.sourceTabId === void 0 || activity.sourceTabId === activeInfo.tabId) continue;
      if (activity.sourceWindowId !== void 0 && activity.providerWindowId !== void 0 && activity.sourceWindowId !== activity.providerWindowId) continue;
      activity.reported = true;
      void emitFocusTelemetry(activity, activeInfo.tabId);
    }
  });
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
    const clickAt = (x, y) => cdpClickAt(target, x, y, 70);
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
      if (!tile.ok || tile.x === void 0 || tile.y === void 0) {
        throw bridgeError("MEDIA_FAILED", `Exact source media ${mediaId} was not found in Flow (${tile.reason ?? "unknown"}).`, true);
      }
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: tile.x, y: tile.y });
      await new Promise((resolve) => setTimeout(resolve, 450));
      const more = await evaluate(`((mediaId) => {
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
          || candidate.getAttribute('aria-label')?.includes('Tu\u1EF3 ch\u1ECDn kh\xE1c')
          || candidate.getAttribute('aria-label')?.includes('More options')
          || candidate.classList.contains('mat-mdc-menu-trigger')
      );
      if (!button && card) {
        button = Array.from(document.querySelectorAll('button')).find(b =>
          (b.classList.contains('mat-mdc-menu-trigger') || b.getAttribute('aria-label')?.includes('Tu\u1EF3 ch\u1ECDn kh\xE1c')) && b.getBoundingClientRect().width > 0
        );
      }
      if (!button) return { ok: false, reason: 'more-vert-not-found' };
      const rect = button.getBoundingClientRect();
      if (rect.width && rect.height) {
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      // Trong Angular Flow m\u1EDBi, button hotbar c\xF3 th\u1EC3 c\xF3 k\xEDch th\u01B0\u1EDBc ban \u0111\u1EA7u 0x0 tr\u01B0\u1EDBc khi hover.
      // K\xEDch ho\u1EA1t click tr\u1EF1c ti\u1EBFp \u0111\u1EC3 m\u1EDF Angular CDK Overlay Menu:
      try {
        button.click();
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        return { ok: true, openedDirectly: true };
      } catch (err) {
        // V\u1EABn tr\u1EA3 v\u1EC1 true \u0111\u1EC3 flow ti\u1EBFp t\u1EE5c t\xECm menu m\u1EDF trong DOM
        return { ok: true, openedDirectly: true };
      }
    })(${JSON.stringify(mediaId)})`);
      if (!more.ok) {
        const startSlot = await evaluate(`(() => {
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
        if (startSlot.ok && startSlot.x !== void 0 && startSlot.y !== void 0) {
          await clickAt(startSlot.x, startSlot.y);
          await new Promise((r) => setTimeout(r, 400));
          return { ok: true, mediaId };
        }
        throw bridgeError("MEDIA_FAILED", `Exact source media ${mediaId} menu was not available (${more.reason ?? "unknown"}).`, true);
      }
      if (!more.openedDirectly && more.x !== void 0 && more.y !== void 0) {
        await clickAt(more.x, more.y);
      }
      await new Promise((resolve) => setTimeout(resolve, 550));
      let animate = await evaluate(`(() => {
      const scopes = [...document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content], .cdk-overlay-pane, mat-menu-panel, .mat-mdc-menu-panel')];
      const item = scopes.flatMap((menu) => [...menu.querySelectorAll('[role="menuitem"], [role="option"], button')])
        .find((candidate) => (candidate.textContent || '').includes('motion_blur') || /T\u1EA1o \u1EA3nh \u0111\u1ED9ng|Animate|Khung h\xECnh b\u1EAFt \u0111\u1EA7u|Start frame/i.test(candidate.innerText || ''));
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
        animate = await evaluate(`(() => {
        const scopes = [...document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content], .cdk-overlay-pane, mat-menu-panel, .mat-mdc-menu-panel')];
        const item = scopes.flatMap((menu) => [...menu.querySelectorAll('[role="menuitem"], [role="option"], button')])
          .find((candidate) => (candidate.textContent || '').includes('motion_blur') || /T\u1EA1o \u1EA3nh \u0111\u1ED9ng|Animate|Khung h\xECnh b\u1EAFt \u0111\u1EA7u|Start frame/i.test(candidate.innerText || ''));
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
        const startSlot = await evaluate(`(() => {
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
        if (startSlot.ok && startSlot.x !== void 0 && startSlot.y !== void 0) {
          await clickAt(startSlot.x, startSlot.y);
          await new Promise((r) => setTimeout(r, 400));
          return { ok: true, mediaId };
        }
        throw bridgeError("MEDIA_FAILED", `Flow Animate action was not found for ${mediaId}.`, true);
      }
      if (!animate.clickedDirectly && animate.x !== void 0 && animate.y !== void 0) {
        await clickAt(animate.x, animate.y);
      }
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
    const clickAt = (x, y) => cdpClickAt(target, x, y, 70);
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
    const clickAt = (x, y) => cdpClickAt(target, x, y, 70);
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
    const clickAt = (point) => cdpClickAt(target, point.x, point.y, 70);
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
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      await ensureInputReachable(target);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const removed = await evaluate(`((projectId) => {
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
          throw bridgeError("PROJECT_MISMATCH", "Flow navigated away while clearing Reference Media.", false);
        }
        if (!removed.removed) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if ((await evaluate(referenceIdsExpression)).length > 0) {
        throw bridgeError("PREFLIGHT_FAILED", "Could not clear existing Flow Reference Media.", true);
      }
      const referenceAddReady = await evaluate(`(() => {
      const button = document.querySelector('button.add-menu-trigger')
        || document.querySelector('button[aria-label="Th\xEAm th\xE0nh ph\u1EA7n v\xE0o \xF4 nh\u1EADp c\xE2u l\u1EC7nh"]')
        || Array.from(document.querySelectorAll('button')).find((candidate) => {
          const aria = candidate.getAttribute('aria-label') || '';
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && aria.includes('Th\xEAm th\xE0nh ph\u1EA7n v\xE0o \xF4 nh\u1EADp c\xE2u l\u1EC7nh');
        });
      if (!button) return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })()`);
      if (!referenceAddReady) {
        throw bridgeError("UI_NOT_READY", "Flow Reference/Ingredients add-menu was not available.", true);
      }
      for (const mediaId of mediaIds) {
        const addTrigger = await evaluate(`(() => {
        const button = document.querySelector('button.add-menu-trigger')
          || document.querySelector('button[aria-label="Th\xEAm th\xE0nh ph\u1EA7n v\xE0o \xF4 nh\u1EADp c\xE2u l\u1EC7nh"]')
          || Array.from(document.querySelectorAll('button')).find((b) => {
              const aria = b.getAttribute('aria-label') || '';
              return (aria.includes('Th\xEAm th\xE0nh ph\u1EA7n')) && b.getBoundingClientRect().top > 500;
            });
        if (!button) return { ok: false };
        const rect = button.getBoundingClientRect();
        return rect.width && rect.height
          ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : { ok: false };
      })()`);
        if (!addTrigger.ok || addTrigger.x === void 0 || addTrigger.y === void 0) {
          throw bridgeError("UI_NOT_READY", "Flow Reference Media picker trigger was not available.", true);
        }
        await clickAt({ x: addTrigger.x, y: addTrigger.y });
        await new Promise((resolve) => setTimeout(resolve, 350));
        let option = { ok: false };
        for (let attempt = 0; attempt < 8; attempt += 1) {
          option = await evaluate(`((mediaId) => {
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
        if (!option.ok || option.x === void 0 || option.y === void 0) {
          throw bridgeError("MEDIA_FAILED", `Exact Reference Media ${mediaId} was not found in the Flow picker.`, true);
        }
        if (!option.selected) {
          await clickAt({ x: option.x, y: option.y });
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        const addButton = await evaluate(`(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"], .cdk-overlay-pane, mat-dialog-container')]
          .find((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
        const button = [...(dialog?.querySelectorAll('button') || [])]
          .find((candidate) => candidate.classList.contains('detail-add-to-prompt-btn')
            || /Th\xEAm v\xE0o c\xE2u l\u1EC7nh|Th\xEAm|Add|X\xE1c nh\u1EADn|Confirm|Ch\u1ECDn|Select/i.test(candidate.innerText || ''));
        if (!button) return { ok: false, reason: 'add-button-not-found' };
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
          return { ok: false, reason: 'add-button-disabled' };
        }
        const rect = button.getBoundingClientRect();
        return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
        if (addButton.ok && addButton.x !== void 0 && addButton.y !== void 0) {
          await clickAt({ x: addButton.x, y: addButton.y });
          await new Promise((resolve) => setTimeout(resolve, 550));
        } else {
          await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13
          }).catch(() => void 0);
          await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13
          }).catch(() => void 0);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        const applied2 = await evaluate(referenceIdsExpression);
        console.info("[FlowGraph Sync] Applied reference media after commit:", applied2);
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const overlays = await evaluate(`[...document.querySelectorAll('.cdk-overlay-pane')].filter((pane) => {
        const rect = pane.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length`).catch(() => 0);
        if (!overlays) break;
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
        await new Promise((resolve) => setTimeout(resolve, 180));
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
  async function bindRealtimeMode(tab, mode) {
    const requested = mode === "IMAGE" || mode === "VIDEO" ? mode : null;
    if (tab.id === void 0 || !requested) {
      throw bridgeError("INVALID_VALUE", "Mode must be IMAGE or VIDEO.", false);
    }
    await ensureDesktopViewport(tab);
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
    const clickAt = (x, y) => cdpClickAt(target, x, y);
    const readChip = () => evaluate(`(() => {
    const button = document.querySelector('button.settings-trigger-button');
    return button ? (button.innerText || '').replace(/\\s+/g, ' ').trim() : '';
  })()`);
    const closeOverlays = async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const count = await evaluate(`document.querySelectorAll('.cdk-overlay-pane, [role="menu"][data-state="open"]').length`).catch(() => 0);
        if (!count) return;
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
        await new Promise((resolve) => setTimeout(resolve, 140));
      }
    };
    const modeMatches = (chip) => canSubmitGenerateWithComposerMode({
      kind: requested === "VIDEO" ? "t2v" : "t2i",
      liveChipText: chip
    });
    try {
      try {
        await chrome.debugger.attach(target, "1.3");
        attached = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already attached/i.test(message)) {
          throw bridgeError("UI_NOT_READY", `Cannot attach debugger to switch mode: ${message}`, true);
        }
      }
      await ensureInputReachable(target);
      await closeOverlays();
      let chip = await readChip();
      if (modeMatches(chip)) return { ok: true, value: requested };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const trigger = await evaluate(`(() => {
        const button = document.querySelector('button.settings-trigger-button');
        if (!button) return { ok: false };
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const r = button.getBoundingClientRect();
        return r.width > 8 && r.height > 8
          ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }
          : { ok: false };
      })()`);
        if (!trigger.ok || trigger.x === void 0 || trigger.y === void 0) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        await clickAt(trigger.x, trigger.y);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const targetMode = await evaluate(`(() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const panes = [...document.querySelectorAll('.cdk-overlay-pane')];
        const pane = panes.find((root) => {
          const text = clean(root.innerText);
          return /H\xECnh \u1EA3nh|Image/i.test(text) && /Video/i.test(text);
        });
        const controls = pane ? [...pane.querySelectorAll('button, [role="tab"], [role="radio"], .mat-button-toggle-button')] : [];
        const wanted = controls.find((control) => {
          const text = clean(control.innerText).toLowerCase();
          return ${requested === "VIDEO"}
            ? (text === 'video' || text.endsWith(' video') || text.includes('videocam video'))
            : (text === 'image' || text === 'h\xECnh \u1EA3nh' || text.endsWith(' h\xECnh \u1EA3nh') || text.includes('image h\xECnh \u1EA3nh'));
        });
        if (!wanted) return { ok: false, options: controls.map((control) => clean(control.innerText)).filter(Boolean) };
        wanted.scrollIntoView({ block: 'center', inline: 'center' });
        const r = wanted.getBoundingClientRect();
        return r.width > 8 && r.height > 8
          ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }
          : { ok: false };
      })()`);
        if (!targetMode.ok || targetMode.x === void 0 || targetMode.y === void 0) {
          await closeOverlays();
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        await clickAt(targetMode.x, targetMode.y);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await closeOverlays();
        let stableReads = 0;
        for (let tick = 0; tick < 6; tick += 1) {
          chip = await readChip();
          stableReads = modeMatches(chip) ? stableReads + 1 : 0;
          if (stableReads >= 2) return { ok: true, value: requested };
          await new Promise((resolve) => setTimeout(resolve, 220));
        }
      }
      let finalStableReads = 0;
      for (let tick = 0; tick < 4; tick += 1) {
        chip = await readChip();
        finalStableReads = modeMatches(chip) ? finalStableReads + 1 : 0;
        if (finalStableReads >= 2) return { ok: true, value: requested };
        if (tick < 3) await new Promise((resolve) => setTimeout(resolve, 180));
      }
      throw bridgeError(
        "UI_NOT_READY",
        `Flow composer did not commit ${requested} mode (chip: ${chip || "none"}).`,
        true
      );
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function bindRealtimeDuration(tab, value) {
    const requested = Number(value);
    if (tab.id === void 0 || !Number.isFinite(requested) || requested <= 0) {
      throw bridgeError("INVALID_VALUE", "Duration must be a positive number of seconds.", false);
    }
    await ensureDesktopViewport(tab);
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
    const clickAt = (x, y) => cdpClickAt(target, x, y);
    const closeOverlays = async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const count = await evaluate(`document.querySelectorAll('.cdk-overlay-pane').length`).catch(() => 0);
        if (!count) return;
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
        await new Promise((resolve) => setTimeout(resolve, 140));
      }
    };
    const readDuration = () => evaluate(`(() => {
    const button = document.querySelector('button.settings-trigger-button');
    const text = (button?.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const match = text.match(/(?:^|\\s)(\\d+)\\s*(?:s|sec|seconds?|gi\xE2y|giay)(?:\\s|$)/i);
    return match ? Number(match[1]) : null;
  })()`);
    try {
      try {
        await chrome.debugger.attach(target, "1.3");
        attached = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already attached/i.test(message)) {
          throw bridgeError("UI_NOT_READY", `Cannot attach debugger to set duration: ${message}`, true);
        }
      }
      await ensureInputReachable(target);
      await closeOverlays();
      if (await readDuration() === requested) return { ok: true, value: requested };
      let lastAvailable = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const trigger = await evaluate(`(() => {
        const button = document.querySelector('button.settings-trigger-button');
        if (!button) return { ok: false };
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const r = button.getBoundingClientRect();
        return r.width > 8 && r.height > 8
          ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }
          : { ok: false };
      })()`);
        if (!trigger.ok || trigger.x === void 0 || trigger.y === void 0) {
          await new Promise((resolve) => setTimeout(resolve, 220));
          continue;
        }
        await clickAt(trigger.x, trigger.y);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const targetDuration = await evaluate(`(() => {
        const parse = (value) => {
          const text = (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          const match = text.match(/^(\\d+)\\s*(?:s|sec|seconds?|gi\xE2y|giay)$/i);
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
        if (!targetDuration.ok || targetDuration.x === void 0 || targetDuration.y === void 0) {
          await closeOverlays();
          if (lastAvailable.length > 0 && !lastAvailable.includes(requested)) {
            throw bridgeError("INVALID_VALUE", `Flow does not expose ${requested}s for the selected model/mode.`, false);
          }
          await new Promise((resolve) => setTimeout(resolve, 220));
          continue;
        }
        await clickAt(targetDuration.x, targetDuration.y);
        await new Promise((resolve) => setTimeout(resolve, 450));
        await closeOverlays();
        let stableReads = 0;
        for (let tick = 0; tick < 6; tick += 1) {
          const applied2 = await readDuration();
          stableReads = applied2 === requested ? stableReads + 1 : 0;
          if (stableReads >= 2) return { ok: true, value: requested };
          await new Promise((resolve) => setTimeout(resolve, 180));
        }
      }
      const applied = await readDuration();
      throw bridgeError("UI_NOT_READY", `Flow duration did not commit ${requested}s (read back ${applied ?? "none"}).`, true);
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function bindRealtimeModel(tab, modelLabel) {
    const requested = modelLabel.trim();
    if (tab.id === void 0 || !requested) {
      throw bridgeError("INVALID_VALUE", "Model requires an exact label.", false);
    }
    await ensureDesktopViewport(tab);
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
    const clickAt = (x, y) => cdpClickAt(target, x, y);
    const chipText = () => evaluate(`(() => {
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
      const hasMode = buttons.some((button) => /(?:^|\\s)(?:H\xECnh \u1EA3nh|Image|Video)$/i.test(clean(button.innerText)));
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
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const count = await evaluate(`[...document.querySelectorAll('.cdk-overlay-pane, [role="menu"][data-state="open"]')].filter((x)=>{const r=x.getBoundingClientRect();return r.width>2&&r.height>2}).length`).catch(() => 0);
        if (!count) break;
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
        await new Promise((resolve) => setTimeout(resolve, 160));
      }
    };
    const listModelOptions = () => evaluate(`(() => {
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
        await chrome.debugger.attach(target, "1.3");
        attached = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already attached/i.test(message)) {
          throw bridgeError("UI_NOT_READY", `Cannot attach debugger to switch model: ${message}`, true);
        }
      }
      await ensureInputReachable(target);
      await closeModelMenu();
      let chip = "";
      for (let switchAttempt = 0; switchAttempt < 3; switchAttempt += 1) {
        chip = await chipText();
        if (composerChipMatchesRequestedModel(chip, requested)) {
          return { ok: true, model: requested };
        }
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
          const trigger = await evaluate(`(() => {
        const btn = document.querySelector('button.settings-trigger-button');
        if (!btn) return { ok: false };
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        const r = btn.getBoundingClientRect();
        return r.width && r.height ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 } : { ok: false };
      })()`);
          if (!trigger.ok || trigger.x === void 0 || trigger.y === void 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          const domOpened = await evaluate(`(()=>{const b=document.querySelector('button.settings-trigger-button');if(!b)return false;b.click();return true})()`);
          if (!domOpened) {
            await clickAt(trigger.x, trigger.y);
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          opened = Boolean(await evaluate(`(()=>{const clean=(v)=>(v||'').replace(/\\s+/g,' ').trim();return [...document.querySelectorAll('.cdk-overlay-pane')].some((root)=>{const buttons=[...root.querySelectorAll('button')];const hasMode=buttons.some((b)=>/(?:^|\\s)(?:H\xECnh \u1EA3nh|Image|Video)$/i.test(clean(b.innerText)));const hasModel=buttons.some((b)=>b.getAttribute('aria-haspopup')==='menu'&&/banana|veo|omni|imagen/i.test(clean(b.innerText)));return hasMode&&hasModel})})()`));
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
          const group = await evaluate(`(() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const roots = [...document.querySelectorAll('.cdk-overlay-pane, [role="menu"], [role="listbox"]')];
        const btn = roots
          .flatMap((root) => [...root.querySelectorAll('button')])
          .find((b) => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const text = clean(b.innerText);
            return b.getAttribute('aria-haspopup') === 'menu'
              && (aria.includes('m\xF4 h\xECnh') || aria.includes('model') || /banana|veo|omni|imagen/i.test(text));
          });
        if (!btn) return { ok: false };
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        const r = btn.getBoundingClientRect();
        return r.width && r.height ? { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 } : { ok: false };
      })()`);
          if (!group.ok || group.x === void 0 || group.y === void 0) {
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
      chip = chip || "";
      throw bridgeError(
        "INVALID_MODEL",
        `Flow model did not commit "${requested}" (chip: ${chip || "none"}).`,
        true
      );
    } finally {
      if (attached) await chrome.debugger.detach(target).catch(() => void 0);
    }
  }
  async function forwardSyncWrite(request) {
    const payload = request.payload ?? {};
    const requestedProjectId = typeof payload.projectId === "string" ? payload.projectId : void 0;
    if (!requestedProjectId) {
      return makeError(request.requestId, "PROJECT_REQUIRED", "Realtime sync requires an explicit projectId.", false);
    }
    const tab = await findFlowTab(requestedProjectId);
    if (!tab?.id) return makeError(request.requestId, "NO_FLOW_TAB", "No Google Flow tab is open.", false);
    await ensureFlowContentScript(tab.id);
    const tabProjectId = projectIdFromUrl(tab.url ?? "");
    if (!tabProjectId || tabProjectId !== requestedProjectId) {
      return makeError(
        request.requestId,
        "PROJECT_MISMATCH",
        `Flow tab project ${tabProjectId ?? "none"} does not match sync project ${requestedProjectId}.`,
        false
      );
    }
    if (request.type === "FLOWGRAPH_SYNC_SET_MODE") {
      try {
        return makeResponse(request.requestId, await bindRealtimeMode(tab, payload.value));
      } catch (error) {
        const normalized = normalizeError(error);
        return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
      }
    }
    if (request.type === "FLOWGRAPH_SYNC_SET_MODEL") {
      try {
        return makeResponse(request.requestId, await bindRealtimeModel(tab, String(payload.value ?? "")));
      } catch (error) {
        const normalized = normalizeError(error);
        return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
      }
    }
    if (request.type === "FLOWGRAPH_SYNC_SET_DURATION") {
      try {
        return makeResponse(request.requestId, await bindRealtimeDuration(tab, payload.value));
      } catch (error) {
        const normalized = normalizeError(error);
        return makeError(request.requestId, normalized.code, normalized.message, normalized.retryable);
      }
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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isSyncRelayMessage(message)) {
      const request2 = message;
      if (SYNC_WRITE_TYPES.has(request2.type)) {
        void withProviderFocusTelemetry(
          focusTelemetryAction(request2.type),
          request2.requestId,
          sender,
          () => forwardSyncWrite(request2)
        ).then(sendResponse);
        return true;
      }
      const notification = message;
      void chrome.runtime.sendMessage({ type: request2.type, requestId: `sw:sync:${request2.requestId ?? "notification"}`, payload: notification.payload }).catch(() => {
      });
      return false;
    }
    const request = message;
    if (request?.type?.startsWith("FLOWGRAPH_")) {
      const task = () => handleRequest(request);
      void (FOCUS_TELEMETRY_REQUEST_TYPES.has(request.type) ? withProviderFocusTelemetry(focusTelemetryAction(request.type), request.requestId, sender, task) : task()).then(sendResponse);
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

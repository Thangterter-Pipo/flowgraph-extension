// Flow payload builders — the exact request shapes verified in
// GOOGLE_FLOW_API_REFERENCE.md + evidence/ fixtures. Kept pure (no chrome/fetch
// imports) so adapter contract tests can assert field-by-field against fixtures.
import type { GeneratePayload } from './bridge';

export function recaptchaContext(token: string): Record<string, unknown> {
  return {
    token,
    applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB',
  };
}

export function clientContext(
  projectId: string,
  token: string,
  options: { tool?: string; userPaygateTier?: string; sessionId?: string } = {},
): Record<string, unknown> {
  return {
    projectId,
    tool: options.tool ?? 'PINHOLE',
    userPaygateTier: options.userPaygateTier ?? 'PAYGATE_TIER_ONE',
    sessionId: options.sessionId ?? `;${Date.now()}`,
    recaptchaContext: recaptchaContext(token),
  };
}

export function mediaGenerationContext(batchId: string): Record<string, unknown> {
  return {
    batchId,
    audioFailurePreference: 'AUDIO_FAILURE_PREFERENCE_UNSPECIFIED',
  };
}

const structuredPrompt = (prompt: string) => ({ parts: [{ text: prompt }] });

/** UI aspect label → registry aspect code (mirrors flowModelRegistry.aspectLabels). */
export function aspectCode(label?: string): string | undefined {
  if (!label) return undefined;
  const normalized = label.trim();
  const map: Record<string, string> = {
    '16:9 (Landscape)': 'LANDSCAPE',
    '9:16 (Portrait)': 'PORTRAIT',
    '1:1 (Square)': 'SQUARE',
    '3:4 (Portrait)': 'PORTRAIT_3_4',
    '4:3 (Landscape)': 'LANDSCAPE_4_3',
  };
  return map[normalized] ?? normalized.replace('VIDEO_ASPECT_RATIO_', '').replace('IMAGE_ASPECT_RATIO_', '');
}

/** Normalize a UI aspect label ("16:9 (Landscape)") to the Flow video enum. */
export function aspectVideo(ratio?: string): string {
  const code = aspectCode(ratio) ?? 'LANDSCAPE';
  return `VIDEO_ASPECT_RATIO_${code}`;
}

/** Normalize a UI aspect label ("16:9 (Landscape)") to the Flow image enum. */
export function aspectImage(ratio?: string): string {
  const code = aspectCode(ratio) ?? 'LANDSCAPE';
  return `IMAGE_ASPECT_RATIO_${code}`;
}

// ---------------------------------------------------------------------------
// Generation builders — one per verified endpoint
// ---------------------------------------------------------------------------

export function buildT2iRequest(payload: GeneratePayload, context: Record<string, unknown>, batchId: string): Record<string, unknown> {
  const ctx = context as Record<string, unknown>;
  return {
    clientContext: ctx,
    mediaGenerationContext: { batchId },
    useNewMedia: true,
    requests: [{
      clientContext: ctx,
      imageModelName: payload.modelKey,
      imageAspectRatio: aspectImage(payload.aspectRatio),
      structuredPrompt: structuredPrompt(payload.prompt ?? ''),
      seed: payload.seed ?? Math.floor(Math.random() * 100000),
      imageInputs: [],
    }],
  };
}

export function buildI2vRequest(payload: GeneratePayload & { startImage: { mediaId: string } }, context: Record<string, unknown>, batchId: string): Record<string, unknown> {
  return {
    mediaGenerationContext: mediaGenerationContext(batchId),
    clientContext: context,
    useV2ModelConfig: true,
    requests: [{
      aspectRatio: aspectVideo(payload.aspectRatio),
      textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? '') },
      startImage: { mediaId: payload.startImage.mediaId },
      videoModelKey: payload.modelKey,
      seed: payload.seed ?? Math.floor(Math.random() * 100000),
      metadata: {},
    }],
  };
}

export function buildT2vRequest(payload: GeneratePayload, context: Record<string, unknown>, batchId: string): Record<string, unknown> {
  return {
    mediaGenerationContext: mediaGenerationContext(batchId),
    clientContext: context,
    useV2ModelConfig: true,
    requests: [{
      aspectRatio: aspectVideo(payload.aspectRatio),
      textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? '') },
      videoModelKey: payload.modelKey,
      seed: payload.seed ?? Math.floor(Math.random() * 100000),
      metadata: {},
    }],
  };
}

export function buildExtendRequest(payload: GeneratePayload & { videoInput: { mediaId: string } }, context: Record<string, unknown>, batchId: string): Record<string, unknown> {
  return {
    mediaGenerationContext: mediaGenerationContext(batchId),
    clientContext: context,
    useV2ModelConfig: true,
    requests: [{
      aspectRatio: aspectVideo(payload.aspectRatio),
      textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? '') },
      videoInput: { mediaId: payload.videoInput.mediaId },
      videoModelKey: payload.modelKey,
      seed: payload.seed ?? Math.floor(Math.random() * 100000),
      metadata: {},
    }],
  };
}

export function buildUpsampleRequest(payload: GeneratePayload & { videoInput: { mediaId: string } }, context: Record<string, unknown>, batchId: string): Record<string, unknown> {
  // Verified shape: resolution is encoded in the model key (veo_3_1_upsampler_1080p / _4k);
  // the request carries no text prompt — only videoInput + model key + metadata:{}.
  return {
    mediaGenerationContext: mediaGenerationContext(batchId),
    clientContext: context,
    useV2ModelConfig: true,
    requests: [{
      aspectRatio: aspectVideo(payload.aspectRatio),
      videoInput: { mediaId: payload.videoInput.mediaId },
      videoModelKey: payload.modelKey,
      metadata: {},
    }],
  };
}

export function buildInterpolationRequest(
  payload: GeneratePayload & { startImage: { mediaId: string }; endImage: { mediaId: string } },
  context: Record<string, unknown>,
  batchId: string,
): Record<string, unknown> {
  return {
    mediaGenerationContext: mediaGenerationContext(batchId),
    clientContext: context,
    useV2ModelConfig: true,
    requests: [{
      aspectRatio: aspectVideo(payload.aspectRatio),
      textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? '') },
      startImage: { mediaId: payload.startImage.mediaId },
      endImage: { mediaId: payload.endImage.mediaId },
      videoModelKey: payload.modelKey,
      seed: payload.seed ?? Math.floor(Math.random() * 100000),
      metadata: {},
    }],
  };
}

export function buildReferenceRequest(
  payload: GeneratePayload & { imageRefs: Array<{ mediaId: string; imageUsageType?: string }> },
  context: Record<string, unknown>,
  batchId: string,
): Record<string, unknown> {
  return {
    mediaGenerationContext: mediaGenerationContext(batchId),
    clientContext: context,
    useV2ModelConfig: true,
    requests: [{
      aspectRatio: aspectVideo(payload.aspectRatio),
      textInput: { structuredPrompt: structuredPrompt(payload.prompt ?? '') },
      referenceImages: payload.imageRefs.map((ref) => ({ mediaId: ref.mediaId, imageUsageType: ref.imageUsageType ?? 'IMAGE_USAGE_TYPE_ASSET' })),
      videoModelKey: payload.modelKey,
      seed: payload.seed ?? Math.floor(Math.random() * 100000),
      metadata: {},
    }],
  };
}

export function buildUploadRequest(projectId: string, imageBytesBase64: string, mimeType: string, fileName: string): Record<string, unknown> {
  return {
    clientContext: { projectId, tool: 'PINHOLE' },
    imageBytes: imageBytesBase64,
    isUserUploaded: true,
    isHidden: false,
    mimeType,
    fileName,
  };
}

export function buildPollRequest(mediaId: string, projectId: string): Record<string, unknown> {
  return { media: [{ name: mediaId, projectId }] };
}

export function buildCancelRequest(mediaId: string): Record<string, unknown> {
  return { mediaId };
}

export function buildCreateProjectRequest(title: string): Record<string, unknown> {
  return { json: { projectTitle: title, toolName: 'PINHOLE' } };
}

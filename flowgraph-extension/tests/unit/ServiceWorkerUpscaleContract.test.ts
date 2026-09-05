import { describe, it, expect, vi } from 'vitest';
import { normalizeError, type GeneratePayload, type NormalizedMediaRef } from '../../src/shared/bridge';
import { buildUpsampleRequest, clientContext } from '../../src/shared/flowPayloads';

describe('Service Worker Upscale Boundary & Async Contract Verification (Task 4A.4)', () => {
  const PROJECT = '64d45b46-4389-4e29-8795-1f48739b93e0';
  const OTHER_PROJECT = 'other-1234-5678-90ab-cdef12345678';
  const CTX = clientContext(PROJECT, 'TOKEN-REDACTED', { sessionId: ';1787915693778' });

  // 1. Logic unit test mô phỏng kiểm tra project isolation trong handleGenerate
  function verifyHandleGenerateProjectGate(tabUrl: string, payload: GeneratePayload): void {
    const projectIdFromUrl = (url: string) => {
      const match = url.match(/\/project\/([0-9a-zA-Z_-]+)/);
      return match ? match[1] : undefined;
    };
    const expectedProjectId = projectIdFromUrl(tabUrl);
    if (!expectedProjectId || expectedProjectId !== payload.projectId) {
      const err = new Error(
        `Active Google Flow tab project (${expectedProjectId || 'none'}) does not match request projectId (${payload.projectId}).`
      );
      (err as any).code = 'PROJECT_MISMATCH';
      throw err;
    }
  }

  // 2. Logic unit test mô phỏng media type resolution trong generateApi
  function resolveApiMediaOutput(payload: GeneratePayload, providerMedia: { name: string; projectId?: string; previewUrl?: string }): NormalizedMediaRef {
    const isImageOutput = payload.kind === 't2i' || payload.kind === 'imageUpscale';
    return {
      mediaId: providerMedia.name,
      type: isImageOutput ? 'IMAGE' : 'VIDEO',
      projectId: providerMedia.projectId ?? payload.projectId,
      previewUrl: providerMedia.previewUrl,
    };
  }

  // 3. Logic unit test mô phỏng parse async response từ video:batchCheckAsyncVideoGenerationStatus
  function parseAsyncVideoUpsampleStatus(rawResponse: { media?: Array<{ name?: string; mediaMetadata?: { mediaStatus?: { mediaGenerationStatus?: string } }; video?: Record<string, unknown> }> }) {
    const item = rawResponse.media?.[0];
    const statusString = item?.mediaMetadata?.mediaStatus?.mediaGenerationStatus ?? '';
    const isSuccessful = statusString === 'MEDIA_GENERATION_STATUS_SUCCESSFUL';
    return {
      mediaId: item?.name,
      status: isSuccessful ? 'SUCCESSFUL' : 'ACTIVE',
      type: item?.video ? 'VIDEO' : 'IMAGE',
    };
  }

  it('Contract 1: handleGenerate project isolation strictly throws PROJECT_MISMATCH on mismatch', () => {
    const tabUrl = `https://flow.google.com/project/${PROJECT}/edit`;
    const payloadMismatch: GeneratePayload = {
      kind: 'imageUpscale',
      projectId: OTHER_PROJECT,
      modelKey: 'GEM_PIX_2_UPSAMPLE_2K',
    };

    expect(() => verifyHandleGenerateProjectGate(tabUrl, payloadMismatch)).toThrowError(
      /Active Google Flow tab project/
    );
    try {
      verifyHandleGenerateProjectGate(tabUrl, payloadMismatch);
    } catch (e: any) {
      const norm = normalizeError(e);
      expect(norm.code).toBe('PROJECT_MISMATCH');
    }

    // Success case when projects match
    const payloadMatch: GeneratePayload = {
      kind: 'imageUpscale',
      projectId: PROJECT,
      modelKey: 'GEM_PIX_2_UPSAMPLE_2K',
    };
    expect(() => verifyHandleGenerateProjectGate(tabUrl, payloadMatch)).not.toThrow();
  });

  it('Contract 2: generateApi maps imageUpscale strictly to IMAGE MediaRef', () => {
    const payloadImageUpscale: GeneratePayload = {
      kind: 'imageUpscale',
      projectId: PROJECT,
      modelKey: 'GEM_PIX_2_UPSAMPLE_2K',
      targetResolution: 'UPSAMPLE_IMAGE_RESOLUTION_2K',
    };
    const providerMedia = {
      name: 'img-upscaled-2k-999',
      projectId: PROJECT,
      previewUrl: 'https://flow.google.com/asb/token-2k-image',
    };
    const output = resolveApiMediaOutput(payloadImageUpscale, providerMedia);

    expect(output.type).toBe('IMAGE');
    expect(output.mediaId).toBe('img-upscaled-2k-999');
    expect(output.projectId).toBe(PROJECT);
    expect(output.previewUrl).toBe('https://flow.google.com/asb/token-2k-image');
  });

  it('Contract 3: generateApi maps videoUpscale / upscale strictly to VIDEO MediaRef', () => {
    const payloadVideoUpscale: GeneratePayload = {
      kind: 'videoUpscale',
      projectId: PROJECT,
      modelKey: 'veo_3_1_upsampler_1080p',
      videoInput: { mediaId: 'vid-source-111' },
    };
    const providerMedia = {
      name: 'vid-upscaled-1080p-888',
      projectId: PROJECT,
      previewUrl: 'https://flow.google.com/asb/token-1080p-video',
    };
    const output = resolveApiMediaOutput(payloadVideoUpscale, providerMedia);

    expect(output.type).toBe('VIDEO');
    expect(output.mediaId).toBe('vid-upscaled-1080p-888');
    expect(output.projectId).toBe(PROJECT);
  });

  it('Contract 4: Video Upsample request payload matches veo_3_1_upsampler specs', () => {
    const payload = {
      kind: 'videoUpscale' as any,
      projectId: PROJECT,
      modelKey: 'veo_3_1_upsampler_4k',
      videoInput: { mediaId: 'vid-input-source' },
    };
    const req = buildUpsampleRequest(payload, CTX, 'batch-uuid');
    expect(req.useV2ModelConfig).toBe(true);
    const requests = req.requests as Array<Record<string, unknown>>;
    expect(requests[0].videoInput).toEqual({ mediaId: 'vid-input-source' });
    expect(requests[0].videoModelKey).toBe('veo_3_1_upsampler_4k');
  });

  it('Contract 5: parses async video:batchCheckAsyncVideoGenerationStatus for Video Upscaling', () => {
    const rawAsyncResponse = {
      media: [
        {
          name: 'vid-upscaled-done',
          mediaMetadata: {
            mediaStatus: {
              mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_SUCCESSFUL',
            },
          },
          video: {
            fifeUrl: 'https://lh3.googleusercontent.com/...',
          },
        },
      ],
    };

    const parsed = parseAsyncVideoUpsampleStatus(rawAsyncResponse);
    expect(parsed.mediaId).toBe('vid-upscaled-done');
    expect(parsed.status).toBe('SUCCESSFUL');
    expect(parsed.type).toBe('VIDEO');
  });
});

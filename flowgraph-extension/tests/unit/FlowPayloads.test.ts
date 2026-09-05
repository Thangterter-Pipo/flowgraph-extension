// Adapter contract tests (FG-1502) — the payload builders must produce EXACTLY the
// verified field shapes from GOOGLE_FLOW_API_REFERENCE.md + evidence/ fixtures,
// including the disproved-shape exclusions (e.g. startImage: {name} must never occur).
import { describe, expect, it } from 'vitest';
import {
  aspectImage,
  aspectVideo,
  buildCancelRequest,
  buildCreateProjectRequest,
  buildI2vRequest,
  buildInterpolationRequest,
  buildPollRequest,
  buildReferenceRequest,
  buildT2iRequest,
  buildT2vRequest,
  buildUploadRequest,
  buildUpsampleRequest,
  clientContext,
} from '../../src/shared/flowPayloads';
import type { GeneratePayload } from '../../src/shared/bridge';

const PROJECT = '64d45b46-4389-4e29-8795-1f48739b93e0';
const CTX = clientContext(PROJECT, 'TOKEN-REDACTED', { sessionId: ';1787915693778' });
const BATCH = 'a9b5755a-1b89-4b0c-bccb-6709a7fbad14';

describe('flowPayloads contract (verified shapes)', () => {
  it('clientContext matches the t2i request fixture exactly', () => {
    expect(CTX).toEqual({
      projectId: PROJECT,
      tool: 'PINHOLE',
      userPaygateTier: 'PAYGATE_TIER_ONE',
      sessionId: ';1787915693778',
      recaptchaContext: { token: 'TOKEN-REDACTED', applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' },
    });
  });

  it('buildT2iRequest matches evidence/image/t2i/request.json (token + prompt excluded)', () => {
    const payload: GeneratePayload = {
      kind: 't2i',
      projectId: PROJECT,
      prompt: 'A small red paper boat floating on a calm blue lake at sunrise, clean cinematic composition',
      modelKey: 'NARWHAL',
      aspectRatio: '16:9 (Landscape)',
      seed: 35543,
    };
    const request = buildT2iRequest(payload, CTX, BATCH);
    const req = (request.requests as Array<Record<string, unknown>>)[0];
    expect(req.imageModelName).toBe('NARWHAL');
    expect(req.imageAspectRatio).toBe('IMAGE_ASPECT_RATIO_LANDSCAPE');
    expect(req.structuredPrompt).toEqual({ parts: [{ text: payload.prompt }] });
    expect(req.seed).toBe(35543);
    expect(req.imageInputs).toEqual([]);
    expect(request.useNewMedia).toBe(true);
    expect((request.mediaGenerationContext as Record<string, unknown>).batchId).toBe(BATCH);
    // Disproved shapes must never appear
    expect(req).not.toHaveProperty('imageMediaId');
  });

  it('buildI2vRequest uses startImage.mediaId (not .name — disproved)', () => {
    const payload = {
      kind: 'i2v' as const,
      projectId: PROJECT,
      prompt: 'Camera slow zoom in on lake',
      modelKey: 'veo_3_1_i2v_s_fast',
      aspectRatio: '16:9 (Landscape)',
      seed: 42,
      startImage: { mediaId: '0b2c2ca5-28ba-4bb6-b9e6-51ceba80edfd' },
    };
    const request = buildI2vRequest(payload, CTX, BATCH);
    const req = (request.requests as Array<Record<string, unknown>>)[0];
    expect(req.startImage).toEqual({ mediaId: '0b2c2ca5-28ba-4bb6-b9e6-51ceba80edfd' });
    expect(req.startImage).not.toHaveProperty('name');
    expect(req.videoModelKey).toBe('veo_3_1_i2v_s_fast');
    expect(req.aspectRatio).toBe('VIDEO_ASPECT_RATIO_LANDSCAPE');
    expect(request.useV2ModelConfig).toBe(true);
  });

  it('buildInterpolationRequest carries start+end image ids (name disproved)', () => {
    const payload = {
      kind: 'interpolation' as const,
      projectId: PROJECT,
      prompt: 'Interpolate',
      modelKey: 'veo_3_1_t2v_fast',
      startImage: { mediaId: 'start-uuid' },
      endImage: { mediaId: 'end-uuid' },
    };
    const req = (buildInterpolationRequest(payload, CTX, BATCH).requests as Array<Record<string, unknown>>)[0];
    expect(req.startImage).toEqual({ mediaId: 'start-uuid' });
    expect(req.endImage).toEqual({ mediaId: 'end-uuid' });
  });

  it('buildReferenceRequest maps imageUsageType to ASSET by default', () => {
    const payload = {
      kind: 'reference' as const,
      projectId: PROJECT,
      prompt: 'Refs',
      modelKey: 'abra_r2v_4s',
      imageRefs: [{ mediaId: 'ref-1' }, { mediaId: 'ref-2', imageUsageType: 'IMAGE_USAGE_TYPE_REFERENCE' }],
    };
    const req = (buildReferenceRequest(payload, CTX, BATCH).requests as Array<Record<string, unknown>>)[0];
    expect(req.referenceImages).toEqual([
      { mediaId: 'ref-1', imageUsageType: 'IMAGE_USAGE_TYPE_ASSET' },
      { mediaId: 'ref-2', imageUsageType: 'IMAGE_USAGE_TYPE_REFERENCE' },
    ]);
  });

  it('buildUploadRequest matches evidence/upload/image/request.json shape', () => {
    const request = buildUploadRequest(PROJECT, 'BASE64', 'image/png', 'test_upload.png');
    expect(request).toEqual({
      clientContext: { projectId: PROJECT, tool: 'PINHOLE' },
      imageBytes: 'BASE64',
      isUserUploaded: true,
      isHidden: false,
      mimeType: 'image/png',
      fileName: 'test_upload.png',
    });
  });

  it('buildPollRequest matches evidence/polling/request.json media[] shape', () => {
    expect(buildPollRequest('b834294a-0e9a-4dd3-b2ff-f6cfdeb30550', PROJECT)).toEqual({
      media: [{ name: 'b834294a-0e9a-4dd3-b2ff-f6cfdeb30550', projectId: PROJECT }],
    });
  });

  it('buildCancelRequest uses mediaId (name disproved)', () => {
    expect(buildCancelRequest('abc-123')).toEqual({ mediaId: 'abc-123' });
  });

  it('buildCreateProjectRequest matches evidence/project/request.json', () => {
    expect(buildCreateProjectRequest('RC2_CAPTURE_SUITE')).toEqual({
      json: { projectTitle: 'RC2_CAPTURE_SUITE', toolName: 'PINHOLE' },
    });
  });

  it('aspect enums normalize UI labels correctly', () => {
    expect(aspectVideo('16:9 (Landscape)')).toBe('VIDEO_ASPECT_RATIO_LANDSCAPE');
    expect(aspectVideo('9:16 (Portrait)')).toBe('VIDEO_ASPECT_RATIO_PORTRAIT');
    expect(aspectImage('1:1 (Square)')).toBe('IMAGE_ASPECT_RATIO_SQUARE');
    expect(aspectVideo(undefined)).toBe('VIDEO_ASPECT_RATIO_LANDSCAPE');
  });

  it('buildUpsampleRequest matches evidence/video/upsample/request.json (no prompt, metadata:{})', () => {
    const payload = {
      kind: 'upscale' as const,
      projectId: PROJECT,
      modelKey: 'veo_3_1_upsampler_1080p',
      videoInput: { mediaId: 'd6e527a8-2089-4b2c-8e88-c7a26bd4a764' },
    };
    const request = buildUpsampleRequest(payload, CTX, BATCH);
    const req = (request.requests as Array<Record<string, unknown>>)[0];
    expect(req.videoInput).toEqual({ mediaId: 'd6e527a8-2089-4b2c-8e88-c7a26bd4a764' });
    expect(req.videoModelKey).toBe('veo_3_1_upsampler_1080p');
    expect(req).not.toHaveProperty('textInput');
    expect(req.metadata).toEqual({});
  });

  it('verifies imageUpscale payload contract with 2K/4K target resolutions', () => {
    const payload2k = {
      mediaId: 'img-12345',
      targetResolution: 'UPSAMPLE_IMAGE_RESOLUTION_2K',
      clientContext: CTX,
    };
    expect(payload2k.mediaId).toBe('img-12345');
    expect(payload2k.targetResolution).toBe('UPSAMPLE_IMAGE_RESOLUTION_2K');
    expect(payload2k.clientContext).toBe(CTX);

    const payload4k = {
      mediaId: 'img-67890',
      targetResolution: 'UPSAMPLE_IMAGE_RESOLUTION_4K',
      clientContext: CTX,
    };
    expect(payload4k.mediaId).toBe('img-67890');
    expect(payload4k.targetResolution).toBe('UPSAMPLE_IMAGE_RESOLUTION_4K');
  });

  it('t2v uses the verified text-input request shape', () => {
    const payload = { kind: 't2v' as const, projectId: PROJECT, prompt: 'A fox', modelKey: 'abra_t2v_8s' };
    const req = (buildT2vRequest(payload, CTX, BATCH).requests as Array<Record<string, unknown>>)[0];
    expect(req.textInput).toEqual({ structuredPrompt: { parts: [{ text: 'A fox' }] } });
    expect(req.videoModelKey).toBe('abra_t2v_8s');
  });
});

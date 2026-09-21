import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROVIDER_MEDIA_CTA,
  UPLOAD_BROWSE_COPY,
  UPLOAD_DROP_COPY,
  UPLOAD_READY_COPY,
  bindProviderMediaInput,
  classifyLocalFile,
  collectVerifiedGraphMedia,
  isPngOrJpeg,
  localImageDropAction,
  localVideoDropAllowed,
  shouldShowProviderSuccessBadge,
  shortMediaId,
} from '../../src/ui/studio/mediaInputUi';

const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';
const UUID = '65bdee87-426f-432c-8b5c-8272bb5fb9fd';

describe('media input UI contracts', () => {
  it('classifies png/jpeg as image and rejects video/other', () => {
    expect(classifyLocalFile({ type: 'image/png' })).toBe('image');
    expect(classifyLocalFile({ type: 'image/jpeg' })).toBe('image');
    expect(isPngOrJpeg({ type: 'image/png' })).toBe(true);
    expect(isPngOrJpeg({ type: 'image/gif' })).toBe(false);
    expect(classifyLocalFile({ type: 'video/mp4' })).toBe('video');
    expect(classifyLocalFile({ type: 'application/pdf' })).toBe('other');
    expect(localVideoDropAllowed()).toBe(false);
  });

  it('stages local images only on Upload Image; canvas and provider inputs spawn Upload Image', () => {
    expect(localImageDropAction('uploadImage', 'node')).toBe('stage-on-upload');
    expect(localImageDropAction('imageInput', 'node')).toBe('stage-on-upload');
    expect(localImageDropAction(undefined, 'canvas')).toBe('spawn-upload');
    expect(localImageDropAction('mediaInput', 'node')).toBe('spawn-upload');
    expect(localImageDropAction('videoInput', 'node')).toBe('reject');
    expect(localImageDropAction('t2i', 'node')).toBe('reject');
  });

  it('never treats local-* / dropped-* as provider success', () => {
    expect(shouldShowProviderSuccessBadge({ status: 'idle', mediaId: 'dropped-1' })).toBe(false);
    expect(shouldShowProviderSuccessBadge({ status: 'success', mediaId: 'local-abc' })).toBe(false);
    expect(shouldShowProviderSuccessBadge({ status: 'success', mediaId: UUID })).toBe(true);
  });

  it('binds provider media fail-closed on type, local key, current, and missing project', () => {
    expect(bindProviderMediaInput({
      kind: 'imageInput', mediaId: UUID, mediaType: 'VIDEO', projectId: PROJECT, activeProjectId: PROJECT,
    }).ok).toBe(false);
    expect(bindProviderMediaInput({
      kind: 'videoInput', mediaId: UUID, mediaType: 'IMAGE', projectId: PROJECT, activeProjectId: PROJECT,
    }).ok).toBe(false);
    expect(bindProviderMediaInput({
      kind: 'imageInput', mediaId: 'dropped-1', mediaType: 'IMAGE', projectId: PROJECT, activeProjectId: PROJECT,
    }).ok).toBe(false);
    expect(bindProviderMediaInput({
      kind: 'imageInput', mediaId: UUID, mediaType: 'IMAGE', projectId: 'current', activeProjectId: PROJECT,
    }).ok).toBe(false);
    expect(bindProviderMediaInput({
      kind: 'mediaInput', mediaId: UUID, mediaType: 'IMAGE', projectId: PROJECT, activeProjectId: PROJECT,
    })).toEqual({ ok: true, mediaId: UUID, mediaType: 'IMAGE', projectId: PROJECT });
  });

  it('collects only graph media with explicit matching project provenance', () => {
    const items = collectVerifiedGraphMedia([
      { id: '1', data: { result: { mediaId: 'dropped-1', type: 'image' }, config: { projectId: PROJECT } } },
      { id: '2', data: { result: { mediaId: UUID, type: 'image' }, config: { projectId: 'current' } } },
      { id: '3', data: { result: { mediaId: UUID, type: 'image', previewUrl: 'blob:x' }, config: { projectId: PROJECT } } },
    ], PROJECT);
    expect(items).toEqual([{
      mediaId: UUID,
      mediaType: 'IMAGE',
      projectId: PROJECT,
      previewUrl: 'blob:x',
      sourceNodeId: '3',
    }]);
  });

  it('collects generated provider results from trusted result.projectId without config.projectId', () => {
    const items = collectVerifiedGraphMedia([
      { id: 't2i', data: { result: { mediaId: UUID, type: 'image', previewUrl: 'blob:preview', projectId: PROJECT } } },
      { id: 'orphan', data: { result: { mediaId: UUID, type: 'image' } } },
      { id: 'current', data: { result: { mediaId: UUID, type: 'image', projectId: 'current' } } },
      { id: 'foreign', data: { result: { mediaId: UUID, type: 'image', projectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } },
    ], PROJECT);
    expect(items).toEqual([{
      mediaId: UUID,
      mediaType: 'IMAGE',
      projectId: PROJECT,
      previewUrl: 'blob:preview',
      sourceNodeId: 't2i',
    }]);
  });

  it('accepts mediaInput manual VIDEO and keeps image/video inputs type-locked', () => {
    expect(bindProviderMediaInput({
      kind: 'mediaInput', mediaId: UUID, mediaType: 'VIDEO', projectId: PROJECT, activeProjectId: PROJECT,
    })).toEqual({ ok: true, mediaId: UUID, mediaType: 'VIDEO', projectId: PROJECT });
    expect(bindProviderMediaInput({
      kind: 'mediaInput', mediaId: UUID, mediaType: '', projectId: PROJECT, activeProjectId: PROJECT,
    }).ok).toBe(false);
    expect(bindProviderMediaInput({
      kind: 'imageInput', mediaId: UUID, mediaType: 'VIDEO', projectId: PROJECT, activeProjectId: PROJECT,
    }).ok).toBe(false);
    expect(bindProviderMediaInput({
      kind: 'videoInput', mediaId: UUID, mediaType: 'IMAGE', projectId: PROJECT, activeProjectId: PROJECT,
    }).ok).toBe(false);
  });

  it('shortens media ids for the HUD', () => {
    expect(shortMediaId(UUID)).toBe('65bdee87…b9fd');
  });

  it('Upload Image node copy is self-explanatory; provider inputs have a Flow media CTA', () => {
    const nodeSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/WorkflowNode.tsx'), 'utf8');
    const mainSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/main.tsx'), 'utf8');
    expect(nodeSrc).toContain('UPLOAD_DROP_COPY');
    expect(nodeSrc).toContain('UPLOAD_BROWSE_COPY');
    expect(nodeSrc).toContain('UPLOAD_READY_COPY');
    expect(nodeSrc).toContain('PROVIDER_MEDIA_CTA');
    expect(UPLOAD_DROP_COPY).toBe('Drop image here');
    expect(UPLOAD_BROWSE_COPY).toBe('Browse file');
    expect(UPLOAD_READY_COPY).toBe('Ready to upload');
    expect(PROVIDER_MEDIA_CTA).toBe('Choose existing Flow media');
    expect(mainSrc).toContain('localImageDropAction');
    expect(mainSrc).not.toMatch(/projectId: 'current'/);
    expect(nodeSrc).toContain('manualMediaType');
    expect(mainSrc).toContain('previewUrl: detail.previewUrl');
  });
});

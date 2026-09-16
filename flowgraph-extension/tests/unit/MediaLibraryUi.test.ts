import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MEDIA_ADD_TITLE,
  MEDIA_AUDIO_COMING_SOON,
  MEDIA_DROP_COPY,
  MEDIA_EMPTY_HINT,
  MEDIA_EMPTY_TITLE,
  MEDIA_SESSION_LABEL,
  MEDIA_TAB_TITLE,
  PROJECT_UPLOAD_VIDEO_DISABLED,
  compactProjectLabel,
  filterSessionMedia,
  isVideoProjectUploadVerified,
  recentUploadsForProject,
  sessionMediaInspector,
  type RecentProjectUpload,
} from '../../src/ui/studio/projectMediaUploadUi';
import { FLOWGRAPH_MEDIA_CLIP, FLOWGRAPH_MEDIA_DRAG } from '../../src/ui/studio/studioClipboard';
import { shortMediaId } from '../../src/ui/studio/mediaInputUi';

const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const IMAGE_ID = '65bdee87-426f-432c-8b5c-8272bb5fb9fd';
const VIDEO_ID = '40e8547b-9bee-4cd9-b0a4-39dbf906f368';

const hero: RecentProjectUpload = {
  id: `${PROJECT}:${IMAGE_ID}`,
  mediaId: IMAGE_ID,
  mediaType: 'IMAGE',
  projectId: PROJECT,
  fileName: 'hero.png',
  previewUrl: 'https://signed.example/x?token=secret-token',
};

const clip: RecentProjectUpload = {
  id: `${PROJECT}:${VIDEO_ID}`,
  mediaId: VIDEO_ID,
  mediaType: 'VIDEO',
  projectId: PROJECT,
  fileName: 'clip.mp4',
  previewUrl: 'blob:chrome-extension://abc/preview',
};

describe('Media tab asset library', () => {
  it('searches filename and shortened mediaId only — never preview/signed URLs', () => {
    expect(filterSessionMedia([hero, clip], { query: 'hero' }).map((item) => item.fileName)).toEqual(['hero.png']);
    expect(filterSessionMedia([hero, clip], { query: shortMediaId(VIDEO_ID) }).map((item) => item.mediaId)).toEqual([VIDEO_ID]);
    expect(filterSessionMedia([hero, clip], { query: 'secret-token' })).toEqual([]);
    expect(filterSessionMedia([hero, clip], { query: 'blob:chrome-extension' })).toEqual([]);
    expect(filterSessionMedia([hero, clip], { query: 'signed.example' })).toEqual([]);
    expect(filterSessionMedia([hero, clip], { kind: 'IMAGE' })).toEqual([hero]);
    expect(filterSessionMedia([hero, clip], { kind: 'VIDEO' })).toEqual([clip]);
    expect(filterSessionMedia([hero, clip], { kind: 'AUDIO' })).toEqual([]);
  });

  it('empty copy is recent media, not a full project library or session-only claim', () => {
    expect(MEDIA_TAB_TITLE).toBe('Media');
    expect(MEDIA_SESSION_LABEL).toBe('Recent media');
    expect(MEDIA_EMPTY_TITLE).toBe('No recent media yet');
    expect(MEDIA_EMPTY_HINT).toBe('Upload an image or paste with Ctrl+V.');
    expect(MEDIA_EMPTY_TITLE.toLowerCase()).not.toMatch(/project library/);
    expect(MEDIA_EMPTY_HINT.toLowerCase()).not.toMatch(/project library/);
    const mediaSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/MediaLibrary.tsx'), 'utf8');
    expect(mediaSrc).toContain('MEDIA_EMPTY_TITLE');
    expect(mediaSrc).toContain('MEDIA_EMPTY_HINT');
    expect(mediaSrc).not.toMatch(/Chưa có media/);
    expect(mediaSrc).not.toMatch(/Project library/i);
  });

  it('keeps video upload fail-closed and exposes Audio only as a disabled coming-soon filter', () => {
    expect(isVideoProjectUploadVerified()).toBe(false);
    expect(PROJECT_UPLOAD_VIDEO_DISABLED).toBe('Video upload not runtime-verified yet');
    expect(MEDIA_AUDIO_COMING_SOON).toBe('Audio coming soon');
    const mediaSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/MediaLibrary.tsx'), 'utf8');
    expect(mediaSrc).toContain('PROJECT_UPLOAD_VIDEO_DISABLED');
    expect(mediaSrc).toContain('MEDIA_AUDIO_COMING_SOON');
    expect(mediaSrc).toMatch(/disabled[\s\S]{0,120}MEDIA_AUDIO_COMING_SOON/);
    expect(mediaSrc).toMatch(/>\s*Audio\s*</);
    expect(mediaSrc).toMatch(/disabled[\s\S]{0,80}PROJECT_UPLOAD_VIDEO_DISABLED/);
  });

  it('inspector only exposes safe metadata', () => {
    const row = sessionMediaInspector(hero);
    expect(row).toEqual({
      fileName: 'hero.png',
      type: 'Image',
      mediaId: shortMediaId(IMAGE_ID),
      projectId: shortMediaId(PROJECT),
    });
    expect(JSON.stringify(row)).not.toMatch(/previewUrl|signed\.example|token=|blob:/);
    const unnamed = sessionMediaInspector({ ...hero, fileName: '' });
    expect(unnamed.fileName).toBe(shortMediaId(IMAGE_ID));
  });

  it('keeps drag MIME contract and project isolation', () => {
    expect(FLOWGRAPH_MEDIA_DRAG).toBe('application/flowgraph-media');
    expect(FLOWGRAPH_MEDIA_CLIP).toBe('flowgraph/media-v1');
    const mediaSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/MediaLibrary.tsx'), 'utf8');
    expect(mediaSrc).toContain('FLOWGRAPH_MEDIA_DRAG');
    expect(mediaSrc).toContain('FLOWGRAPH_MEDIA_CLIP');
    expect(recentUploadsForProject([hero, { ...clip, projectId: OTHER }], PROJECT)).toEqual([hero]);
    expect(compactProjectLabel('Watch ad', PROJECT)).toBe(`Watch ad · ${shortMediaId(PROJECT)}`);
  });

  it('Add media area is compact and not UPLOAD TO PROJECT', () => {
    expect(MEDIA_ADD_TITLE).toBe('Add media');
    expect(MEDIA_DROP_COPY).toBe('Drop files here or browse');
    const mediaSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/MediaLibrary.tsx'), 'utf8');
    expect(mediaSrc).toContain('MEDIA_ADD_TITLE');
    expect(mediaSrc).toContain('MEDIA_DROP_COPY');
    expect(mediaSrc).not.toContain('PROJECT_UPLOAD_TITLE');
    expect(mediaSrc).toContain('media-library-grid');
    expect(mediaSrc).toContain('media-library-inspector');
  });
});

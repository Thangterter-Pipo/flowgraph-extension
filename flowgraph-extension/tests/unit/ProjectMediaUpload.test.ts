import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROJECT_UPLOAD_VIDEO_DISABLED,
  acceptProjectUploadResult,
  beginProjectImageUpload,
  friendlyUploadError,
  isVideoProjectUploadVerified,
  projectUploadAvailability,
  recentUploadAsVerifiedMedia,
  recentUploadInputKind,
  recentUploadsForProject,
  sanitizeRecentUploadsForPersist,
} from '../../src/ui/studio/projectMediaUploadUi';

const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';
const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UUID = '65bdee87-426f-432c-8b5c-8272bb5fb9fd';

describe('sidebar project media uploader', () => {
  it('renders Image + Video actions and disables when no project or running', () => {
    const mainSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/main.tsx'), 'utf8');
    const mediaSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/MediaLibrary.tsx'), 'utf8');
    expect(mediaSrc).toContain('PROJECT_UPLOAD_VIDEO_DISABLED');
    expect(mainSrc).toContain('MediaLibrary');
    expect(PROJECT_UPLOAD_VIDEO_DISABLED).toBe('Video upload not runtime-verified yet');
    expect(projectUploadAvailability({ activeProjectId: PROJECT, runStatus: 'ready', canvasUnlocked: true }).ok).toBe(true);
    expect(projectUploadAvailability({ activeProjectId: '', runStatus: 'ready', canvasUnlocked: true }).ok).toBe(false);
    expect(projectUploadAvailability({ activeProjectId: PROJECT, runStatus: 'running', canvasUnlocked: true }).ok).toBe(false);
    expect(isVideoProjectUploadVerified()).toBe(false);
    const docs = readFileSync(resolve(__dirname, '../../docs/GOOGLE_FLOW_API_REFERENCE.md'), 'utf8');
    expect(docs).toMatch(/Video Upload `\[BUNDLE_VERIFIED\]`/);
    expect(docs).not.toMatch(/Video Upload `\[RUNTIME_VERIFIED\]`/);
    expect(mediaSrc).toMatch(/disabled title=\{PROJECT_UPLOAD_VIDEO_DISABLED\}/);
  });

  it('accepts PNG/JPEG image upload into the snapshot project and rejects video/other', () => {
    expect(beginProjectImageUpload({
      file: { type: 'image/png', name: 'a.png' },
      activeProjectId: PROJECT,
      runStatus: 'ready',
      canvasUnlocked: true,
    })).toEqual({ ok: true, projectId: PROJECT });
    expect(beginProjectImageUpload({
      file: { type: 'video/mp4', name: 'a.mp4' },
      activeProjectId: PROJECT,
      runStatus: 'ready',
      canvasUnlocked: true,
    }).ok).toBe(false);
    expect(beginProjectImageUpload({
      file: { type: 'image/png' },
      activeProjectId: PROJECT,
      runStatus: 'running',
      canvasUnlocked: true,
    }).ok).toBe(false);
  });

  it('creates trusted Image Input provenance and never uses current or local keys', () => {
    const accepted = acceptProjectUploadResult({
      snapshotProjectId: PROJECT,
      currentProjectId: PROJECT,
      mediaId: UUID,
      mediaType: 'IMAGE',
      fileName: 'hero.png',
      previewUrl: 'https://signed.example/x?token=1',
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.item.projectId).toBe(PROJECT);
    expect(accepted.item.mediaId).toBe(UUID);
    expect(recentUploadInputKind(accepted.item)).toBe('imageInput');
    const verified = recentUploadAsVerifiedMedia(accepted.item, PROJECT);
    expect(verified?.projectId).toBe(PROJECT);
    expect(verified?.mediaId).toBe(UUID);
    expect(acceptProjectUploadResult({
      snapshotProjectId: PROJECT,
      currentProjectId: PROJECT,
      mediaId: 'dropped-1',
      mediaType: 'IMAGE',
      fileName: 'x.png',
    }).ok).toBe(false);
    expect(acceptProjectUploadResult({
      snapshotProjectId: 'current',
      currentProjectId: PROJECT,
      mediaId: UUID,
      mediaType: 'IMAGE',
      fileName: 'x.png',
    }).ok).toBe(false);
  });

  it('does not leak or relabel an upload after project switch', () => {
    const accepted = acceptProjectUploadResult({
      snapshotProjectId: PROJECT,
      currentProjectId: OTHER,
      mediaId: UUID,
      mediaType: 'IMAGE',
      fileName: 'hero.png',
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.visibleInCurrentProject).toBe(false);
    expect(accepted.item.projectId).toBe(PROJECT);
    expect(recentUploadsForProject([accepted.item], OTHER)).toEqual([]);
    expect(recentUploadsForProject([accepted.item], PROJECT)).toHaveLength(1);
    expect(sanitizeRecentUploadsForPersist([accepted.item])[0]).not.toHaveProperty('previewUrl');
  });

  it('hides raw Google OAuth errors from the media tab', () => {
    expect(friendlyUploadError({ code: 'AUTH_EXPIRED', message: 'Request had invalid authentication credentials. Expected OAuth 2 access token' })).toBe('Flow session expired. Refresh the Flow tab and retry.');
    expect(friendlyUploadError(new Error('Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie'))).toBe('Flow session expired. Refresh the Flow tab and retry.');
    expect(friendlyUploadError({ code: 'NO_FLOW_TAB', message: 'No Google Flow tab is open.' })).toBe('Open Google Flow first.');
  });
});

import { isLocalMediaKey, trustedProjectIdForProviderMedia } from '../../runtime/mediaProvenance';
import { bindProviderMediaInput, isPngOrJpeg, shortMediaId, type VerifiedGraphMedia } from './mediaInputUi';

export const PROJECT_UPLOAD_TITLE = 'UPLOAD TO PROJECT';
export const PROJECT_UPLOAD_DROP_COPY = 'Drop image or video here';
export const PROJECT_UPLOAD_VIDEO_DISABLED = 'Video upload not runtime-verified yet';
export const MEDIA_TAB_TITLE = 'Media';
export const MEDIA_SESSION_LABEL = 'Recent media';
export const MEDIA_EMPTY_TITLE = 'No recent media yet';
export const MEDIA_EMPTY_HINT = 'Upload an image or paste with Ctrl+V.';
export const MEDIA_ADD_TITLE = 'Add media';
export const MEDIA_DROP_COPY = 'Drop files here or browse';
export const MEDIA_AUDIO_COMING_SOON = 'Audio coming soon';

export type SessionMediaFilter = 'all' | 'IMAGE' | 'VIDEO' | 'AUDIO';

export type ProjectUploadState = 'idle' | 'validating' | 'uploading' | 'success' | 'error';

export type RecentProjectUpload = {
  id: string;
  mediaId: string;
  mediaType: 'IMAGE' | 'VIDEO';
  projectId: string;
  fileName: string;
  previewUrl?: string;
};

export function isVideoProjectUploadVerified(): false {
  return false;
}

export function projectUploadAvailability(args: {
  activeProjectId?: string;
  runStatus?: string;
  canvasUnlocked?: boolean;
}): { ok: true; projectId: string } | { ok: false; reason: string } {
  const projectId = String(args.activeProjectId ?? '').trim();
  if (!projectId || projectId === 'current') return { ok: false, reason: 'No active project' };
  if (args.canvasUnlocked === false) return { ok: false, reason: 'Canvas locked' };
  if (args.runStatus === 'running') return { ok: false, reason: 'Run in progress' };
  return { ok: true, projectId };
}

export function classifyProjectUploadFile(file: { type: string; name?: string }): 'image' | 'video' | 'other' {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return 'other';
}

export function beginProjectImageUpload(args: {
  file: { type: string; name?: string };
  activeProjectId?: string;
  runStatus?: string;
  canvasUnlocked?: boolean;
}): { ok: true; projectId: string } | { ok: false; code: string; message: string } {
  const gate = projectUploadAvailability(args);
  if (!gate.ok) return { ok: false, code: 'INVALID_INPUT', message: gate.reason };
  if (classifyProjectUploadFile(args.file) === 'video') {
    return { ok: false, code: 'INVALID_INPUT', message: PROJECT_UPLOAD_VIDEO_DISABLED };
  }
  if (!isPngOrJpeg(args.file)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Only PNG/JPEG can be uploaded to the project.' };
  }
  return { ok: true, projectId: gate.projectId };
}

export function acceptProjectUploadResult(args: {
  snapshotProjectId: string;
  currentProjectId: string;
  mediaId: string;
  mediaType: 'IMAGE' | 'VIDEO';
  fileName: string;
  previewUrl?: string;
}): { ok: true; item: RecentProjectUpload; visibleInCurrentProject: boolean } | { ok: false; code: string; message: string } {
  const snapshot = String(args.snapshotProjectId ?? '').trim();
  const current = String(args.currentProjectId ?? '').trim();
  const mediaId = String(args.mediaId ?? '').trim();
  if (!snapshot || snapshot === 'current') return { ok: false, code: 'PROJECT_ISOLATION', message: 'Upload snapshot project is untrusted.' };
  if (!mediaId || isLocalMediaKey(mediaId)) return { ok: false, code: 'INVALID_INPUT', message: 'Provider mediaId is required.' };
  if (args.mediaType !== 'IMAGE' && args.mediaType !== 'VIDEO') {
    return { ok: false, code: 'INVALID_INPUT', message: 'mediaType must be IMAGE or VIDEO.' };
  }
  const provenance = trustedProjectIdForProviderMedia({
    configProjectId: snapshot,
    activeProjectId: snapshot,
    mediaId,
  });
  if (!provenance.ok) return provenance;
  const item: RecentProjectUpload = {
    id: `${snapshot}:${mediaId}`,
    mediaId,
    mediaType: args.mediaType,
    projectId: provenance.projectId,
    fileName: String(args.fileName ?? '').trim(),
    previewUrl: args.previewUrl,
  };
  return { ok: true, item, visibleInCurrentProject: current === snapshot };
}

export function recentUploadsForProject(items: RecentProjectUpload[], activeProjectId: string): RecentProjectUpload[] {
  const projectId = String(activeProjectId ?? '').trim();
  if (!projectId || projectId === 'current') return [];
  return items.filter((item) => item.projectId === projectId && !isLocalMediaKey(item.mediaId));
}

export function sanitizeRecentUploadsForPersist(items: RecentProjectUpload[]): Array<Omit<RecentProjectUpload, 'previewUrl'>> {
  return items.map(({ previewUrl: _previewUrl, ...rest }) => rest);
}

export function recentUploadAsVerifiedMedia(item: RecentProjectUpload, activeProjectId: string): VerifiedGraphMedia | null {
  const bound = bindProviderMediaInput({
    kind: item.mediaType === 'VIDEO' ? 'videoInput' : 'imageInput',
    mediaId: item.mediaId,
    mediaType: item.mediaType,
    projectId: item.projectId,
    activeProjectId,
  });
  if (!bound.ok) return null;
  return {
    mediaId: bound.mediaId,
    mediaType: bound.mediaType,
    projectId: bound.projectId,
    previewUrl: item.previewUrl,
    sourceNodeId: `recent:${item.id}`,
  };
}

export function recentUploadInputKind(item: RecentProjectUpload): 'imageInput' | 'videoInput' {
  return item.mediaType === 'VIDEO' ? 'videoInput' : 'imageInput';
}

export function recentUploadLabel(item: RecentProjectUpload): string {
  const name = item.fileName || shortMediaId(item.mediaId);
  return `${item.mediaType} ${name}`;
}

export function compactProjectLabel(name?: string, id?: string): string {
  const label = String(name ?? '').trim();
  const projectId = String(id ?? '').trim();
  if (label && projectId && projectId !== 'current') return `${label} · ${shortMediaId(projectId)}`;
  if (label) return label;
  if (projectId && projectId !== 'current') return shortMediaId(projectId);
  return '';
}

export function sessionMediaSearchHaystack(item: RecentProjectUpload): string {
  return `${item.fileName} ${shortMediaId(item.mediaId)} ${item.mediaId}`.toLowerCase();
}

export function filterSessionMedia(
  items: RecentProjectUpload[],
  args: { query?: string; kind?: SessionMediaFilter } = {},
): RecentProjectUpload[] {
  const kind = args.kind ?? 'all';
  if (kind === 'AUDIO') return [];
  const query = String(args.query ?? '').trim().toLowerCase();
  return items.filter((item) => {
    if (kind !== 'all' && item.mediaType !== kind) return false;
    if (!query) return true;
    return sessionMediaSearchHaystack(item).includes(query);
  });
}

export function sessionMediaInspector(item: RecentProjectUpload): {
  fileName: string;
  type: 'Image' | 'Video';
  mediaId: string;
  projectId: string;
} {
  return {
    fileName: item.fileName || shortMediaId(item.mediaId),
    type: item.mediaType === 'VIDEO' ? 'Video' : 'Image',
    mediaId: shortMediaId(item.mediaId),
    projectId: shortMediaId(item.projectId),
  };
}

export function friendlyUploadError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code || '') : '';
  const raw = error instanceof Error ? error.message : String(error || '');
  if (code === 'NO_FLOW_TAB' || /no google flow tab/i.test(raw)) return 'Open Google Flow first.';
  if (code === 'AUTH_EXPIRED' || /invalid authentication credentials|OAuth 2 access token|sign-in\/web\/devconsole/i.test(raw)) {
    return 'Flow session expired. Refresh the Flow tab and retry.';
  }
  return raw.replace(/\s+/g, ' ').slice(0, 160);
}

export const MEDIA_LIBRARY_STORAGE_KEY = 'flowgraph.mediaLibrary.v1';

export function loadMediaLibrary(projectId: string, storage: Pick<Storage, 'getItem'> = localStorage): RecentProjectUpload[] {
  const id = String(projectId ?? '').trim();
  if (!id || id === 'current') return [];
  try {
    const raw = storage.getItem(MEDIA_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, RecentProjectUpload[]>;
    return recentUploadsForProject(Array.isArray(parsed[id]) ? parsed[id] : [], id);
  } catch {
    return [];
  }
}

export function saveMediaLibrary(projectId: string, items: RecentProjectUpload[], storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const id = String(projectId ?? '').trim();
  if (!id || id === 'current') return;
  let parsed: Record<string, RecentProjectUpload[]> = {};
  try {
    parsed = JSON.parse(storage.getItem(MEDIA_LIBRARY_STORAGE_KEY) || '{}') as Record<string, RecentProjectUpload[]>;
  } catch {
    parsed = {};
  }
  parsed[id] = sanitizeRecentUploadsForPersist(recentUploadsForProject(items, id));
  storage.setItem(MEDIA_LIBRARY_STORAGE_KEY, JSON.stringify(parsed));
}

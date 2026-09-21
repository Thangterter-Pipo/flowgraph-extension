import { isLocalMediaKey, trustedProjectIdForProviderMedia } from '../../runtime/mediaProvenance';

export const UPLOAD_DROP_COPY = 'Drop image here';
export const UPLOAD_BROWSE_COPY = 'Browse file';
export const UPLOAD_READY_COPY = 'Ready to upload';
export const PROVIDER_MEDIA_CTA = 'Choose existing Flow media';

export type LocalFileClass = 'image' | 'video' | 'other';
export type LocalImageDropAction = 'stage-on-upload' | 'spawn-upload' | 'reject';

export function classifyLocalFile(file: { type: string; name?: string }): LocalFileClass {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return 'other';
}

export function isPngOrJpeg(file: { type: string }): boolean {
  const type = (file.type || '').toLowerCase();
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/jpg';
}

export function isProviderInputKind(kind: string): boolean {
  return kind === 'imageInput' || kind === 'videoInput' || kind === 'mediaInput';
}

export function localImageDropAction(kind: string | undefined, target: 'node' | 'canvas'): LocalImageDropAction {
  if (target === 'canvas') return 'spawn-upload';
  if (kind === 'uploadImage' || kind === 'imageInput') return 'stage-on-upload';
  if (kind === 'videoInput') return 'reject';
  if (isProviderInputKind(kind ?? '')) return 'spawn-upload';
  return 'reject';
}

export function localVideoDropAllowed(): false {
  return false;
}

export function shortMediaId(mediaId: string): string {
  const id = mediaId.trim();
  if (id.length <= 13) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function allowedProviderMediaTypes(kind: string): ReadonlyArray<'IMAGE' | 'VIDEO'> {
  if (kind === 'imageInput') return ['IMAGE'];
  if (kind === 'videoInput') return ['VIDEO'];
  if (kind === 'mediaInput') return ['IMAGE', 'VIDEO'];
  return [];
}

export function bindProviderMediaInput(args: {
  kind: string;
  mediaId: string;
  mediaType: string;
  projectId: string;
  activeProjectId: string;
}): { ok: true; mediaId: string; mediaType: 'IMAGE' | 'VIDEO'; projectId: string } | { ok: false; code: string; message: string } {
  const mediaId = String(args.mediaId ?? '').trim();
  const mediaType = String(args.mediaType ?? '').trim().toUpperCase();
  const allowed = allowedProviderMediaTypes(args.kind);
  if (!mediaId) return { ok: false, code: 'INVALID_INPUT', message: 'mediaId is required.' };
  if (isLocalMediaKey(mediaId)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Local files are not provider media. Drop a PNG/JPEG onto Image Input.' };
  }
  if (!allowed.includes(mediaType as 'IMAGE' | 'VIDEO')) {
    return { ok: false, code: 'INVALID_INPUT', message: `${args.kind} cannot bind mediaType "${mediaType}".` };
  }
  const provenance = trustedProjectIdForProviderMedia({
    configProjectId: args.projectId,
    activeProjectId: args.activeProjectId,
    mediaId,
  });
  if (!provenance.ok) return provenance;
  return { ok: true, mediaId, mediaType: mediaType as 'IMAGE' | 'VIDEO', projectId: provenance.projectId };
}

export function shouldShowProviderSuccessBadge(args: { status?: string; mediaId?: string }): boolean {
  const mediaId = String(args.mediaId ?? '').trim();
  if (mediaId && isLocalMediaKey(mediaId)) return false;
  if (args.status === 'success') return true;
  if (mediaId && args.status !== 'running' && args.status !== 'failed') return true;
  return false;
}

export type VerifiedGraphMedia = {
  mediaId: string;
  mediaType: 'IMAGE' | 'VIDEO';
  projectId: string;
  previewUrl?: string;
  sourceNodeId: string;
};

export function collectVerifiedGraphMedia(
  nodes: Array<{
    id: string;
    data?: {
      kind?: string;
      status?: string;
      config?: Record<string, string>;
      result?: { mediaId?: string; type?: string; previewUrl?: string; projectId?: string };
    };
  }>,
  activeProjectId: string,
): VerifiedGraphMedia[] {
  const out: VerifiedGraphMedia[] = [];
  for (const node of nodes) {
    const mediaId = String(node.data?.result?.mediaId ?? node.data?.config?.mediaId ?? '').trim();
    if (!mediaId || isLocalMediaKey(mediaId)) continue;
    const rawType = String(node.data?.result?.type ?? node.data?.config?.mediaType ?? '').toUpperCase();
    const mediaType = rawType === 'VIDEO' ? 'VIDEO' : rawType === 'IMAGE' ? 'IMAGE' : null;
    if (!mediaType) continue;
    const projectId = String(node.data?.result?.projectId ?? node.data?.config?.projectId ?? '').trim();
    const provenance = trustedProjectIdForProviderMedia({
      configProjectId: projectId,
      activeProjectId,
      mediaId,
    });
    if (!provenance.ok) continue;
    out.push({
      mediaId,
      mediaType,
      projectId: provenance.projectId,
      previewUrl: node.data?.result?.previewUrl,
      sourceNodeId: node.id,
    });
  }
  return out;
}

export type MediaSettingsRow = { label: string; value: string };

function normalizeMediaType(raw: string | undefined): 'IMAGE' | 'VIDEO' | '' {
  const value = String(raw ?? '').trim().toUpperCase();
  if (value === 'VIDEO' || value === 'IMAGE') return value;
  if (value === 'VID') return 'VIDEO';
  return '';
}

export function mediaNodeSettingsRows(args: {
  kind: string;
  status?: string;
  config?: Record<string, string>;
  result?: { mediaId?: string; type?: string; previewUrl?: string; fileName?: string; projectId?: string };
}): MediaSettingsRow[] {
  const config = args.config ?? {};
  const mediaId = String(args.result?.mediaId ?? config.mediaId ?? '').trim();
  const fileName = String(args.result?.fileName ?? config.fileName ?? '').trim();
  const mediaType = normalizeMediaType(args.result?.type ?? config.mediaType);
  const projectId = String(args.result?.projectId ?? config.projectId ?? '').trim();
  const rows: MediaSettingsRow[] = [];

  if (args.kind === 'uploadImage') {
    if (!mediaId) {
      rows.push({ label: 'Source', value: 'Empty' });
      rows.push({ label: 'State', value: 'Empty' });
      rows.push({ label: 'Action', value: 'Drop image here / Browse file' });
      return rows;
    }
    if (isLocalMediaKey(mediaId)) {
      rows.push({ label: 'Source', value: 'Local file' });
      if (fileName) rows.push({ label: 'File', value: fileName });
      rows.push({ label: 'State', value: 'Ready to upload' });
      return rows;
    }
    rows.push({ label: 'Source', value: 'Provider media' });
    rows.push({ label: 'State', value: 'Uploaded' });
    rows.push({ label: 'Media', value: shortMediaId(mediaId) });
    if (projectId && projectId !== 'current') rows.push({ label: 'Project', value: shortMediaId(projectId) });
    return rows;
  }

  if (isProviderInputKind(args.kind)) {
    const locked = args.kind === 'videoInput' ? 'VIDEO' : args.kind === 'imageInput' ? 'IMAGE' : mediaType;
    if (locked) rows.push({ label: 'Type', value: locked });
    if (!mediaId) {
      rows.push({ label: 'Source', value: 'Unbound' });
      rows.push({ label: 'Action', value: 'Choose existing Flow media' });
      return rows;
    }
    rows.push({ label: 'Source', value: 'Existing Flow media' });
    rows.push({ label: 'Media', value: shortMediaId(mediaId) });
    if (!projectId || projectId === 'current') rows.push({ label: 'Provenance', value: 'Untrusted' });
    else rows.push({ label: 'Project', value: shortMediaId(projectId) });
    return rows;
  }

  if (args.kind === 'preview') {
    rows.push({ label: 'Role', value: 'Output Preview / Run Target' });
    rows.push({ label: 'State', value: mediaId ? 'Connected' : 'Empty' });
    if (mediaType) rows.push({ label: 'Type', value: mediaType });
    if (mediaId && !isLocalMediaKey(mediaId)) rows.push({ label: 'Media', value: shortMediaId(mediaId) });
    if (projectId && projectId !== 'current') rows.push({ label: 'Project', value: shortMediaId(projectId) });
    rows.push({ label: 'Note', value: 'Execution sink, pass-through' });
    return rows;
  }

  return rows;
}

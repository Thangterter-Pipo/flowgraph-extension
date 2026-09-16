/** Trusted project provenance for existing provider media. Literal "current" is not proof. */

export const LOCAL_MEDIA_PREFIXES = ['local-', 'dropped-'] as const;

export function isLocalMediaKey(mediaId: string): boolean {
  return LOCAL_MEDIA_PREFIXES.some((prefix) => mediaId.startsWith(prefix));
}

export function trustedProjectIdForProviderMedia(args: {
  configProjectId: string | undefined;
  activeProjectId: string | undefined;
  mediaId: string;
}): { ok: true; projectId: string } | { ok: false; code: 'PROJECT_ISOLATION' | 'INVALID_INPUT'; message: string } {
  const mediaId = String(args.mediaId ?? '').trim();
  const active = String(args.activeProjectId ?? '').trim();
  const config = String(args.configProjectId ?? '').trim();
  if (!active) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Requires an active project.' };
  }
  if (!config) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Requires explicit projectId provenance.' };
  }
  if (config === 'current') {
    return {
      ok: false,
      code: 'PROJECT_ISOLATION',
      message: `projectId "current" is not trusted provenance for media ${mediaId || '(empty)'}. Bind media from the active project.`,
    };
  }
  if (config !== active) {
    return {
      ok: false,
      code: 'PROJECT_ISOLATION',
      message: `Media belongs to project ${config}, not the active project ${active}.`,
    };
  }
  return { ok: true, projectId: active };
}

export function attachTrustedProjectToNodeResult<T extends { mediaId?: string; projectId?: string } | undefined>(
  result: T,
  activeProjectId: string | undefined,
): T {
  if (!result?.mediaId || isLocalMediaKey(result.mediaId)) return result;
  const existing = String(result.projectId ?? '').trim();
  if (existing && existing !== 'current') return result;
  const active = String(activeProjectId ?? '').trim();
  if (!active || active === 'current') return result;
  return { ...result, projectId: active };
}

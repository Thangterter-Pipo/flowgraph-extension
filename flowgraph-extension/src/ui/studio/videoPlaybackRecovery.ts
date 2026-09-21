import type { MediaStatusData, MediaStatusPayload } from '../../shared/bridge';
import { DOWNLOAD_RESOLVE_BUDGET_MS } from '../../shared/timeouts';
import { isStitchArtifact, stitchArtifactUrl } from '../../runtime/stitch/StitchArtifactStore';

type PlaybackProbe = Pick<
  HTMLVideoElement,
  'play' | 'paused' | 'readyState' | 'currentTime' | 'addEventListener' | 'removeEventListener'
>;

const PLAYBACK_PROGRESS_EPSILON_SECONDS = 0.01;
const PLAYBACK_PROGRESS_TIMEOUT_MS = 1_500;
const PASSIVE_RECOVERY_TIMEOUT_MS = 10_000;
const REFRESH_RECOVERY_TIMEOUT_MS = DOWNLOAD_RESOLVE_BUDGET_MS + 10_000;

/**
 * Generic Flow preview resolution may return an image/poster URL for VIDEO
 * media. Those sources can stall a <video> element indefinitely without firing
 * an error, so they must be replaced through exact-ID video recovery.
 */
export function shouldRecoverVideoSource(source?: string): boolean {
  const value = String(source ?? '').trim();
  if (!value) return true;
  const lower = value.toLowerCase();
  if (lower.startsWith('blob:') || lower.startsWith('data:video/')) return false;
  if (lower.includes('/video/') || /\.(?:mp4|webm|mov|m3u8)(?:$|[?#])/i.test(value)) return false;
  return lower.startsWith('data:image/')
    || lower.includes('/image/')
    || lower.includes('flow.google.com/asb/');
}

/**
 * Positive playback proof requires decoded readiness, a successful play(), and
 * observable timeline advancement. canplay / !paused alone are not proof that
 * the exact source is actually advancing.
 */
export async function playVerified(
  video: PlaybackProbe,
  progressTimeoutMs = PLAYBACK_PROGRESS_TIMEOUT_MS,
): Promise<boolean> {
  const startedAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  try {
    // Do not reject merely because a freshly replaced source has not decoded a
    // frame yet. Calling play() is allowed to start/finish loading that exact
    // source; positive verification still requires real timeline advancement.
    await video.play();
  } catch {
    return false;
  }
  if (video.paused || video.readyState < 2) return false;
  if (video.currentTime > startedAt + PLAYBACK_PROGRESS_EPSILON_SECONDS) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (verified: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      video.removeEventListener('timeupdate', onProgress);
      resolve(verified);
    };
    const onProgress = () => {
      if (
        !video.paused
        && video.readyState >= 2
        && video.currentTime > startedAt + PLAYBACK_PROGRESS_EPSILON_SECONDS
      ) {
        finish(true);
      }
    };
    video.addEventListener('timeupdate', onProgress);
    timer = setTimeout(() => finish(false), Math.max(0, progressTimeoutMs));
    onProgress();
  });
}

/**
 * One exact-ID recovery attempt. Passive recovery only reads a currently loaded
 * exact clip. `refresh=true` is reserved for explicit user intent and permits
 * the worker to refresh the exact provider VIDEO source through Flow's own UI.
 * URL resolution alone is still not playback proof; playVerified() must pass.
 */
export async function recoverExactVideo(
  mediaId: string,
  projectId: string,
  request: (payload: MediaStatusPayload) => Promise<MediaStatusData>,
  refresh = false,
): Promise<string> {
  if (isStitchArtifact(mediaId)) return stitchArtifactUrl(mediaId, projectId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutMs = refresh ? REFRESH_RECOVERY_TIMEOUT_MS : PASSIVE_RECOVERY_TIMEOUT_MS;
    const response = await Promise.race([
      request({
        mediaId,
        projectId,
        playbackRecovery: true,
        ...(refresh ? { playbackRefresh: true } : {}),
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Cannot recover exact video within ${Math.round(timeoutMs / 1000)} seconds.`)),
          timeoutMs,
        );
      }),
    ]);
    const media = response.media;
    if (
      response.status !== 'SUCCESSFUL'
      || media?.mediaId !== mediaId
      || media.projectId !== projectId
      || media.type !== 'VIDEO'
      || !media.previewUrl
    ) {
      throw new Error('Cannot recover exact video. Open this clip in Flow and try again; no generation was started.');
    }
    return media.previewUrl;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

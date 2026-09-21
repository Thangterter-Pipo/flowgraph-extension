/** In-memory generation abort registry. Correlates UI AbortSignal to SW work by requestId. */

export const ABORT_GENERATE_TYPE = 'FLOWGRAPH_ABORT_GENERATE' as const;
export const GENERATE_PROGRESS_TYPE = 'FLOWGRAPH_GENERATE_PROGRESS' as const;

export interface AbortGeneratePayload {
  requestId: string;
}

export interface GenerateProgressPayload {
  requestId: string;
  mediaId: string;
}

export interface InFlightGeneration {
  projectId: string;
  mediaId?: string;
}

const abortedIds = new Set<string>();
const inFlight = new Map<string, InFlightGeneration>();

export function generationAbortedError(): Error & { code: string; retryable: boolean } {
  const error = new Error('Generation aborted') as Error & { code: string; retryable: boolean };
  error.code = 'CANCELLED';
  error.retryable = false;
  return error;
}

export function markGenerationAborted(requestId: string): void {
  if (requestId) abortedIds.add(requestId);
}

export function isGenerationAborted(requestId: string | undefined): boolean {
  return Boolean(requestId && abortedIds.has(requestId));
}

export function clearGenerationAbort(requestId: string | undefined): void {
  if (requestId) abortedIds.delete(requestId);
}

export function throwIfGenerationAborted(requestId: string | undefined): void {
  if (isGenerationAborted(requestId)) throw generationAbortedError();
}

export function trackGenerationStart(requestId: string | undefined, projectId: string): void {
  if (requestId) inFlight.set(requestId, { projectId });
}

export function trackGenerationMedia(requestId: string | undefined, mediaId: string | undefined): void {
  if (!requestId || !mediaId) return;
  const row = inFlight.get(requestId);
  if (row) row.mediaId = mediaId;
  else inFlight.set(requestId, { projectId: '', mediaId });
}

export function getGenerationFlight(requestId: string | undefined): InFlightGeneration | undefined {
  return requestId ? inFlight.get(requestId) : undefined;
}

export function endGeneration(requestId: string | undefined): void {
  if (requestId) inFlight.delete(requestId);
  clearGenerationAbort(requestId);
}

export function resetGenerationAbortState(): void {
  abortedIds.clear();
  inFlight.clear();
}

/** Sleep `ms`, but throw CANCELLED as soon as this requestId is aborted. */
export async function waitWhileNotAborted(
  ms: number,
  requestId: string | undefined,
  stepMs = 200,
): Promise<void> {
  const deadline = Date.now() + Math.max(0, ms);
  const step = Math.max(20, stepMs);
  while (Date.now() < deadline) {
    throwIfGenerationAborted(requestId);
    const slice = Math.min(step, deadline - Date.now());
    if (slice <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, slice));
  }
  throwIfGenerationAborted(requestId);
}

/** Resolves only when this requestId is aborted. Hangs if requestId is missing. */
export async function untilGenerationAborted(
  requestId: string | undefined,
  stepMs = 200,
): Promise<void> {
  if (!requestId) return new Promise(() => undefined);
  const step = Math.max(20, stepMs);
  while (!isGenerationAborted(requestId)) {
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

/**
 * If this request was Stop'd, never return success. Cancel only a real provider
 * mediaId (never a graph nodeId). Sibling requestIds are untouched.
 */
export async function finalizeGenerateAgainstAbort<T extends { mediaId?: string }>(
  requestId: string | undefined,
  result: T,
  cancelByMediaId?: (mediaId: string) => Promise<unknown>,
): Promise<T> {
  if (result.mediaId) trackGenerationMedia(requestId, result.mediaId);
  if (!isGenerationAborted(requestId)) return result;
  if (result.mediaId && cancelByMediaId) {
    await cancelByMediaId(result.mediaId).catch(() => undefined);
  }
  throw generationAbortedError();
}

export function applyGenerateProgress(
  message: unknown,
  requestId: string,
  onMediaId?: (mediaId: string) => void,
): void {
  if (!onMediaId || !message || typeof message !== 'object') return;
  const msg = message as { type?: string; requestId?: string; mediaId?: string };
  if (msg.type !== GENERATE_PROGRESS_TYPE) return;
  if (msg.requestId !== requestId) return;
  if (!msg.mediaId) return;
  onMediaId(msg.mediaId);
}

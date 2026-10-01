// Shared cancellable generate — abort the local wait immediately, and track a
// real provider mediaId as soon as the adapter reports one. Never treat a graph
// nodeId as a mediaId.
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import type { GeneratePayload, NormalizedMediaRef } from '../../shared/bridge';
import { type ExecutionContext, raceWithSignal } from '../ExecutionContext';

export async function generateCancellable(
  adapter: GoogleFlowAdapter,
  payload: GeneratePayload,
  context: ExecutionContext,
  abortSignal?: AbortSignal,
): Promise<NormalizedMediaRef> {
  const signal = abortSignal ?? context.abortSignal;
  const generatePromise = adapter.generate({
    ...payload,
    transportPreference: payload.transportPreference ?? context.transportPreference,
  }, {
    abortSignal: signal,
    onMediaId: (mediaId) => {
      if (mediaId) context.trackMediaJob(mediaId);
    },
  });
  try {
    const ref = await raceWithSignal(generatePromise, signal);
    context.throwIfAborted();
    return ref;
  } catch (error) {
    void generatePromise.catch(() => undefined);
    throw error;
  }
}

// ImageToVideoExecutor (FG-0603) — consumes the upstream image MediaRef from the
// previous node, requests real I2V generation, polls, returns video MediaRef.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asMedia, asText, mediaRefFromPayload, mergeCharacterDna } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { PollManager } from '../PollManager';
import { normalizeFlowUiModelLabel } from '../../shared/sync/SyncCapabilityRegistry';
import { generateCancellable } from './generateCancellable';

export interface ImageToVideoExecutorOptions {
  adapter: GoogleFlowAdapter;
  poller?: PollManager;
}

export class ImageToVideoExecutor implements NodeExecutor {
  readonly kind = 'i2v';
  private readonly adapter: GoogleFlowAdapter;
  private readonly poller: PollManager;

  constructor(options: ImageToVideoExecutorOptions) {
    this.adapter = options.adapter;
    this.poller = options.poller ?? new PollManager();
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const image = asMedia(context.inputs.image);
    if (!image) return { valid: false, errors: ['Image-to-Video requires an image from a connected node.'] };
    if (!context.context.activeProject.projectId) return { valid: false, errors: ['Image-to-Video requires an active project.'] };
    return { valid: true, errors: [] };
  }

  async execute(context: NodeExecutionContext, abortSignal?: AbortSignal): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const image = asMedia(context.inputs.image);
    if (!image) throw new RuntimeError('INVALID_INPUT', 'Image-to-Video received no image input.', { nodeId: context.nodeId });
    const projectId = context.context.activeProject.projectId;
    const rawPrompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '');
    const characterInput = context.inputs.characters || context.inputs.character;
    const prompt = mergeCharacterDna(rawPrompt.trim(), characterInput, 'MOTION EXECUTION');
    const modelKey = String(context.config.usageKey ?? context.config.model ?? 'abra_i2v_8s');

    // Fail before touching the Flow UI. An empty prompt used to be replaced by a
    // hard-coded placeholder inside the service worker, so the run "succeeded"
    // with a clip nobody asked for. Attribution of the finished video tile also
    // depends on knowing the prompt we submitted.
    if (!prompt.trim()) {
      throw new RuntimeError('INVALID_INPUT', 'Image-to-Video received no prompt input. Connect a Prompt node to the Prompt input.', { nodeId: context.nodeId });
    }

    if (image.projectId !== projectId) {
      throw new RuntimeError('PROJECT_ISOLATION', `Input image belongs to project ${image.projectId}, not the active project ${projectId}.`, { nodeId: context.nodeId });
    }

    let ref;
    try {
      ref = await generateCancellable(this.adapter, {
        kind: 'i2v',
        projectId,
        prompt: prompt || undefined,
        modelKey,
        modelLabel: context.config.model ? normalizeFlowUiModelLabel(String(context.config.model)) : undefined,
        aspectRatio: String(context.config.aspectRatio ?? '16:9 (Landscape)'),
        durationSeconds: context.config.duration !== undefined ? Number.parseInt(String(context.config.duration), 10) : undefined,
        targetResolution: context.config.targetResolution !== undefined || context.config.resolution !== undefined
          ? String(context.config.targetResolution ?? context.config.resolution)
          : undefined,
        batchCount: context.config.batchCount !== undefined ? Number.parseInt(String(context.config.batchCount).replace(/^x/i, ''), 10) : undefined,
        seed: context.config.seed !== undefined ? Number(context.config.seed) : undefined,
        startImage: { mediaId: image.mediaId },
      }, context.context, abortSignal);
    } catch (error) {
      throw toRuntime(error, context.nodeId);
    }
    context.context.throwIfAborted();

    // The CDP generate path confirms completion directly on the signed-in Flow
    // UI (a new video tile appeared and its mediaId was recovered from the
    // /edit/<mediaId> URL), so the render is already proven done. The legacy
    // aisandbox-pa bearer status API is dead for migrated flow.google accounts
    // (AUTH_EXPIRED), so we skip polling whenever generate reports completion or
    // hands back a resolved URL. The download step re-resolves the URL from the
    // page when previewUrl is empty. Only when neither signal is present do we
    // fall back to the poller below.
    if (ref.completedViaUi || ref.previewUrl) {
      const media = mediaRefFromPayload({ ...ref, previewUrl: ref.previewUrl });
      return {
        outputs: { video: media },
        result: {
          type: 'video',
          mediaId: ref.mediaId,
          previewUrl: ref.previewUrl ?? '',
          mimeType: 'video/mp4',
        },
      };
    }

    context.context.trackMediaJob?.(ref.mediaId);
    try {
      const status = await this.poller.untilTerminal(async () => {
        context.context.throwIfAborted();
        const poll = await this.adapter.waitForMedia({ projectId, mediaId: ref.mediaId });
        return { status: poll.status, errorMessage: poll.errorMessage, data: poll.media };
      }, { abortSignal });

      if (status.status === 'CANCELED') throw new RuntimeError('CANCELLED', 'Generation was cancelled by the provider.', { nodeId: context.nodeId });
      if (status.status === 'FAILED') throw new RuntimeError('MEDIA_FAILED', status.errorMessage ?? 'Video generation failed.', { nodeId: context.nodeId });
      if (status.status === 'UNKNOWN') throw new RuntimeError('TIMEOUT', status.errorMessage ?? 'Polling timed out waiting for the generated video.', { nodeId: context.nodeId });

      const pollMedia = status.data as { previewUrl?: string } | undefined;
      const media = mediaRefFromPayload({ ...ref, previewUrl: pollMedia?.previewUrl });
      return {
        outputs: { video: media },
        result: {
          type: 'video',
          mediaId: ref.mediaId,
          previewUrl: pollMedia?.previewUrl ?? '',
          mimeType: 'video/mp4',
        },
      };
    } finally {
      context.context.completeMediaJob?.(ref.mediaId);
    }
  }

  retryable(error: { code: string }): boolean {
    return error.code === 'AUTH_EXPIRED' || error.code === 'CAPTCHA_REQUIRED' || error.code === 'TIMEOUT';
  }
}

function toRuntime(error: unknown, nodeId: string): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return new RuntimeError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error), { nodeId });
}

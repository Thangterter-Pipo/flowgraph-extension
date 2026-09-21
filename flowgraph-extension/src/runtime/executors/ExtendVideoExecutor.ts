// ExtendVideoExecutor — consumes upstream video MediaRef,
// requests Extend Forward or Edit Video generation from Google Flow, polls, returns video MediaRef.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asText, mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { PollManager } from '../PollManager';
import { normalizeFlowUiModelLabel } from '../../shared/sync/SyncCapabilityRegistry';
import { generateCancellable } from './generateCancellable';

export interface ExtendVideoExecutorOptions {
  adapter: GoogleFlowAdapter;
  poller?: PollManager;
}

export class ExtendVideoExecutor implements NodeExecutor {
  readonly kind = 'extend';
  private readonly adapter: GoogleFlowAdapter;
  private readonly poller: PollManager;

  constructor(options: ExtendVideoExecutorOptions) {
    this.adapter = options.adapter;
    this.poller = options.poller ?? new PollManager();
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const videoInput = context.inputs.video;
    const prompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '');
    const mode = String(context.config.mode ?? 'Extend Forward');
    const errors: string[] = [];

    if (!videoInput) {
      errors.push('Extend/Edit Video requires a video input connected.');
    } else {
      const val = Array.isArray(videoInput) ? videoInput[0] : videoInput;
      if (val.type !== 'video' || !val.value || typeof val.value !== 'object' || !('mediaId' in val.value) || !(val.value as any).mediaId) {
        errors.push('Extend/Edit Video input must strictly be a valid VIDEO MediaRef.');
      }
    }

    if (!prompt.trim()) {
      errors.push('Extend/Edit Video requires a prompt from a connected node or node configuration.');
    }

    if (mode !== 'Extend Forward' && mode !== 'Edit Video') {
      errors.push(`Invalid mode "${mode}". Mode must be "Extend Forward" or "Edit Video".`);
    }

    if (!context.context.activeProject.projectId) {
      errors.push('Extend/Edit Video requires an active project.');
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext, abortSignal?: AbortSignal): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const videoInput = context.inputs.video;
    if (!videoInput) {
      throw new RuntimeError('INVALID_INPUT', 'Extend/Edit Video received no video input.', { nodeId: context.nodeId });
    }

    const val = Array.isArray(videoInput) ? videoInput[0] : videoInput;
    if (val.type !== 'video' || !val.value || typeof val.value !== 'object' || !('mediaId' in val.value)) {
      throw new RuntimeError('INVALID_INPUT', 'Extend/Edit Video input must strictly be a VIDEO MediaRef.', { nodeId: context.nodeId });
    }

    const refVideo = val.value as { mediaId?: string; projectId?: string; type?: string };
    if (!refVideo.mediaId || !refVideo.mediaId.trim()) {
      throw new RuntimeError('INVALID_INPUT', 'Video input has empty mediaId.', { nodeId: context.nodeId });
    }

    if (refVideo.type !== 'VIDEO') {
      throw new RuntimeError('INVALID_INPUT', `Video input ${refVideo.mediaId} is of type ${refVideo.type}, expected VIDEO.`, { nodeId: context.nodeId });
    }

    const projectId = context.context.activeProject.projectId;
    if (refVideo.projectId !== projectId) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Input Video ${refVideo.mediaId} belongs to project ${refVideo.projectId}, not the active project ${projectId}.`,
        { nodeId: context.nodeId },
      );
    }

    const prompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '');
    if (!prompt.trim()) {
      throw new RuntimeError(
        'INVALID_INPUT',
        'Extend/Edit Video received no prompt input. Connect a Prompt node or configure a prompt.',
        { nodeId: context.nodeId },
      );
    }

    const mode = String(context.config.mode ?? 'Extend Forward');
    if (mode !== 'Extend Forward' && mode !== 'Edit Video') {
      throw new RuntimeError('INVALID_INPUT', `Invalid mode "${mode}". Mode must be "Extend Forward" or "Edit Video".`, { nodeId: context.nodeId });
    }

    const modelKey = String(context.config.usageKey ?? context.config.model ?? 'veo_3_1_extend');

    let ref;
    try {
      ref = await generateCancellable(this.adapter, {
        kind: 'extend',
        projectId,
        prompt: prompt.trim(),
        modelKey,
        modelLabel: context.config.model ? normalizeFlowUiModelLabel(String(context.config.model)) : undefined,
        mode,
        aspectRatio: String(context.config.aspectRatio ?? '16:9 (Landscape)'),
        durationSeconds: context.config.duration !== undefined ? Number.parseInt(String(context.config.duration), 10) : undefined,
        targetResolution: context.config.targetResolution !== undefined || context.config.resolution !== undefined
          ? String(context.config.targetResolution ?? context.config.resolution)
          : undefined,
        batchCount: context.config.batchCount !== undefined ? Number.parseInt(String(context.config.batchCount).replace(/^x/i, ''), 10) : undefined,
        seed: context.config.seed !== undefined ? Number(context.config.seed) : undefined,
        videoInput: {
          mediaId: refVideo.mediaId,
        },
      }, context.context, abortSignal);
    } catch (error) {
      throw toRuntime(error, context.nodeId);
    }
    context.context.throwIfAborted();

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
      if (status.status === 'FAILED') throw new RuntimeError('MEDIA_FAILED', status.errorMessage ?? 'Extend/Edit video generation failed.', { nodeId: context.nodeId });
      if (status.status === 'UNKNOWN') throw new RuntimeError('TIMEOUT', status.errorMessage ?? 'Polling timed out waiting for video.', { nodeId: context.nodeId });

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

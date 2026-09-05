// VideoUpscaleExecutor — consumes upstream VIDEO MediaRef,
// requests 1080p or 4K Video Upsampling from Google Flow, polls, returns upscaled VIDEO MediaRef.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { PollManager } from '../PollManager';

export interface VideoUpscaleExecutorOptions {
  adapter: GoogleFlowAdapter;
  poller?: PollManager;
}

export class VideoUpscaleExecutor implements NodeExecutor {
  readonly kind = 'videoUpscale';
  private readonly adapter: GoogleFlowAdapter;
  private readonly poller: PollManager;

  constructor(options: VideoUpscaleExecutorOptions) {
    this.adapter = options.adapter;
    this.poller = options.poller ?? new PollManager();
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const videoInput = context.inputs.video;
    const targetResolution = String(context.config.targetResolution ?? context.config.resolution ?? '1080p');
    const errors: string[] = [];

    if (!videoInput) {
      errors.push('Video Upscale requires a video connected to the Video input.');
    } else {
      const val = Array.isArray(videoInput) ? videoInput[0] : videoInput;
      if (val.type !== 'video' || !val.value || typeof val.value !== 'object' || !('mediaId' in val.value) || !(val.value as any).mediaId) {
        errors.push('Video Upscale input must strictly be a valid VIDEO MediaRef.');
      }
    }

    if (targetResolution !== '1080p' && targetResolution !== '4K' && targetResolution !== 'UPSAMPLE1080' && targetResolution !== 'UPSAMPLE4K') {
      errors.push(`Invalid targetResolution "${targetResolution}". Must be "1080p" or "4K".`);
    }

    if (!context.context.activeProject.projectId) {
      errors.push('Video Upscale requires an active project.');
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext, abortSignal?: AbortSignal): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const videoInput = context.inputs.video;
    if (!videoInput) {
      throw new RuntimeError('INVALID_INPUT', 'Video Upscale received no video input.', { nodeId: context.nodeId });
    }

    const val = Array.isArray(videoInput) ? videoInput[0] : videoInput;
    if (val.type !== 'video' || !val.value || typeof val.value !== 'object' || !('mediaId' in val.value)) {
      throw new RuntimeError('INVALID_INPUT', 'Video Upscale input must strictly be a VIDEO MediaRef.', { nodeId: context.nodeId });
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

    let targetResolution = String(context.config.targetResolution ?? context.config.resolution ?? '1080p');
    const is4k = targetResolution === '4K' || targetResolution === 'UPSAMPLE4K';
    const modelKey = String(context.config.usageKey ?? (is4k ? 'veo_3_1_upsampler_4k' : 'veo_3_1_upsampler_1080p'));

    let initialResult;
    try {
      initialResult = await this.adapter.generate({
        kind: 'upscale',
        projectId,
        modelKey,
        targetResolution: is4k ? '4K' : '1080p',
        videoInput: { mediaId: refVideo.mediaId },
      });
    } catch (err) {
      throw toRuntimeError(err, context.nodeId);
    }

    if (context.context.throwIfAborted(), initialResult.completedViaUi || initialResult.previewUrl) {
      return {
        outputs: { video: mediaRefFromPayload({ ...initialResult, previewUrl: initialResult.previewUrl, type: 'VIDEO' }) },
        result: {
          type: 'video',
          mediaId: initialResult.mediaId,
          previewUrl: initialResult.previewUrl ?? '',
          mimeType: 'video/mp4',
        },
      };
    }

    const status = await this.poller.untilTerminal(async () => {
      context.context.throwIfAborted();
      const current = await this.adapter.waitForMedia({ projectId, mediaId: initialResult.mediaId });
      return {
        status: current.status,
        errorMessage: current.errorMessage,
        data: current.media,
      };
    }, { abortSignal });

    if (status.status === 'CANCELED') {
      throw new RuntimeError('CANCELLED', 'Generation was cancelled by the provider.', { nodeId: context.nodeId });
    }
    if (status.status === 'FAILED') {
      throw new RuntimeError('MEDIA_FAILED', status.errorMessage ?? 'Video upscale failed.', { nodeId: context.nodeId });
    }
    if (status.status === 'UNKNOWN') {
      throw new RuntimeError('TIMEOUT', status.errorMessage ?? 'Polling timed out waiting for upscaled video.', { nodeId: context.nodeId });
    }

    const finalMedia = status.data as { previewUrl?: string } | undefined;
    return {
      outputs: { video: mediaRefFromPayload({ ...initialResult, previewUrl: finalMedia?.previewUrl, type: 'VIDEO' }) },
      result: {
        type: 'video',
        mediaId: initialResult.mediaId,
        previewUrl: finalMedia?.previewUrl ?? '',
        mimeType: 'video/mp4',
      },
    };
  }

  retryable(error: RuntimeError): boolean {
    return error.code === 'AUTH_EXPIRED' || error.code === 'CAPTCHA_REQUIRED' || error.code === 'TIMEOUT';
  }
}

function toRuntimeError(err: unknown, nodeId: string): RuntimeError {
  if (err instanceof RuntimeError) return err;
  return new RuntimeError('PROVIDER_ERROR', err instanceof Error ? err.message : String(err), { nodeId });
}

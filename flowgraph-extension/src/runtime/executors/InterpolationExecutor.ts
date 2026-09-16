// InterpolationExecutor — consumes startImage and endImage upstream MediaRefs,
// requests real Interpolation video generation from Google Flow, polls, returns video MediaRef.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asMedia, asText, mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { PollManager } from '../PollManager';
import { normalizeFlowUiModelLabel } from '../../shared/sync/SyncCapabilityRegistry';
import { generateCancellable } from './generateCancellable';

export interface InterpolationExecutorOptions {
  adapter: GoogleFlowAdapter;
  poller?: PollManager;
}

export class InterpolationExecutor implements NodeExecutor {
  readonly kind = 'interpolation';
  private readonly adapter: GoogleFlowAdapter;
  private readonly poller: PollManager;

  constructor(options: InterpolationExecutorOptions) {
    this.adapter = options.adapter;
    this.poller = options.poller ?? new PollManager();
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const start = asMedia(context.inputs.startImage);
    const end = asMedia(context.inputs.endImage);
    const prompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '');
    const errors: string[] = [];

    if (!start) errors.push('Interpolation requires a Start Image from a connected node.');
    if (!end) errors.push('Interpolation requires an End Image from a connected node.');
    if (!prompt.trim()) {
      errors.push('Interpolation requires a prompt from a connected node or node configuration.');
    }
    if (!context.context.activeProject.projectId) errors.push('Interpolation requires an active project.');
    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext, abortSignal?: AbortSignal): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const start = asMedia(context.inputs.startImage);
    const end = asMedia(context.inputs.endImage);

    if (!start) {
      throw new RuntimeError('INVALID_INPUT', 'Interpolation received no Start Image input.', { nodeId: context.nodeId });
    }
    if (!end) {
      throw new RuntimeError('INVALID_INPUT', 'Interpolation received no End Image input.', { nodeId: context.nodeId });
    }

    const projectId = context.context.activeProject.projectId;
    if (start.projectId !== projectId) {
      throw new RuntimeError('PROJECT_ISOLATION', `Start Image belongs to project ${start.projectId}, not the active project ${projectId}.`, { nodeId: context.nodeId });
    }
    if (end.projectId !== projectId) {
      throw new RuntimeError('PROJECT_ISOLATION', `End Image belongs to project ${end.projectId}, not the active project ${projectId}.`, { nodeId: context.nodeId });
    }

    const prompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '');
    if (!prompt.trim()) {
      throw new RuntimeError(
        'INVALID_INPUT',
        'Interpolation received no prompt input. Connect a Prompt node or configure a prompt.',
        { nodeId: context.nodeId },
      );
    }

    const modelKey = String(context.config.usageKey ?? (String(context.config.model ?? '').includes('Quality') ? 'veo_3_1_quality' : 'veo_3_1_interpolation'));

    let ref;
    try {
      ref = await generateCancellable(this.adapter, {
        kind: 'interpolation',
        projectId,
        prompt: prompt.trim(),
        modelKey,
        modelLabel: context.config.model ? normalizeFlowUiModelLabel(String(context.config.model)) : undefined,
        aspectRatio: String(context.config.aspectRatio ?? '16:9 (Landscape)'),
        durationSeconds: context.config.duration !== undefined ? Number.parseInt(String(context.config.duration), 10) : undefined,
        targetResolution: context.config.targetResolution !== undefined || context.config.resolution !== undefined
          ? String(context.config.targetResolution ?? context.config.resolution)
          : undefined,
        batchCount: context.config.batchCount !== undefined ? Number.parseInt(String(context.config.batchCount).replace(/^x/i, ''), 10) : undefined,
        seed: context.config.seed !== undefined ? Number(context.config.seed) : undefined,
        startImage: { mediaId: start.mediaId },
        endImage: { mediaId: end.mediaId },
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
      if (status.status === 'FAILED') throw new RuntimeError('MEDIA_FAILED', status.errorMessage ?? 'Video interpolation failed.', { nodeId: context.nodeId });
      if (status.status === 'UNKNOWN') throw new RuntimeError('TIMEOUT', status.errorMessage ?? 'Polling timed out waiting for the interpolated video.', { nodeId: context.nodeId });

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

// ReferenceVideoExecutor — consumes multiple ordered upstream reference image MediaRefs,
// requests real Reference-Images video generation from Google Flow, polls, returns video MediaRef.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asMediaList, asText, mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { PollManager } from '../PollManager';
import { normalizeFlowUiModelLabel } from '../../shared/sync/SyncCapabilityRegistry';

export interface ReferenceVideoExecutorOptions {
  adapter: GoogleFlowAdapter;
  poller?: PollManager;
}

export class ReferenceVideoExecutor implements NodeExecutor {
  readonly kind = 'reference';
  private readonly adapter: GoogleFlowAdapter;
  private readonly poller: PollManager;

  constructor(options: ReferenceVideoExecutorOptions) {
    this.adapter = options.adapter;
    this.poller = options.poller ?? new PollManager();
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const refs = asMediaList(context.inputs.references);
    const prompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '');
    const errors: string[] = [];

    if (refs.length === 0) {
      errors.push('Reference Video requires at least one Reference Image from a connected node.');
    }
    if (!prompt.trim()) {
      errors.push('Reference Video requires a prompt from a connected node or node configuration.');
    }
    if (!context.context.activeProject.projectId) {
      errors.push('Reference Video requires an active project.');
    }
    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext, abortSignal?: AbortSignal): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const refs = asMediaList(context.inputs.references);
    if (refs.length === 0) {
      throw new RuntimeError('INVALID_INPUT', 'Reference Video received no reference images input.', { nodeId: context.nodeId });
    }

    const projectId = context.context.activeProject.projectId;
    for (const refItem of refs) {
      if (refItem.projectId !== projectId) {
        throw new RuntimeError(
          'PROJECT_ISOLATION',
          `Reference Image ${refItem.mediaId} belongs to project ${refItem.projectId}, not the active project ${projectId}.`,
          { nodeId: context.nodeId },
        );
      }
    }

    const prompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '');
    if (!prompt.trim()) {
      throw new RuntimeError(
        'INVALID_INPUT',
        'Reference Video received no prompt input. Connect a Prompt node or configure a prompt.',
        { nodeId: context.nodeId },
      );
    }

    const modelKey = String(context.config.usageKey ?? context.config.model ?? 'veo_3_1_reference');
    const imageRefs = refs.map((refItem) => ({
      mediaId: refItem.mediaId,
      imageUsageType: 'IMAGE_USAGE_TYPE_ASSET',
    }));

    let ref;
    try {
      ref = await this.adapter.generate({
        kind: 'reference',
        projectId,
        prompt: prompt.trim(),
        modelKey,
        modelLabel: context.config.model ? normalizeFlowUiModelLabel(String(context.config.model)) : undefined,
        aspectRatio: String(context.config.aspectRatio ?? '16:9 (Landscape)'),
        durationSeconds: context.config.duration !== undefined ? Number.parseInt(String(context.config.duration), 10) : undefined,
        targetResolution: context.config.targetResolution !== undefined || context.config.resolution !== undefined
          ? String(context.config.targetResolution ?? context.config.resolution)
          : undefined,
        seed: context.config.seed !== undefined ? Number(context.config.seed) : undefined,
        imageRefs,
      });
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

    const status = await this.poller.untilTerminal(async () => {
      context.context.throwIfAborted();
      const poll = await this.adapter.waitForMedia({ projectId, mediaId: ref.mediaId });
      return { status: poll.status, errorMessage: poll.errorMessage, data: poll.media };
    }, { abortSignal });

    if (status.status === 'CANCELED') throw new RuntimeError('CANCELLED', 'Generation was cancelled by the provider.', { nodeId: context.nodeId });
    if (status.status === 'FAILED') throw new RuntimeError('MEDIA_FAILED', status.errorMessage ?? 'Reference video generation failed.', { nodeId: context.nodeId });
    if (status.status === 'UNKNOWN') throw new RuntimeError('TIMEOUT', status.errorMessage ?? 'Polling timed out waiting for reference video.', { nodeId: context.nodeId });

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
  }

  retryable(error: { code: string }): boolean {
    return error.code === 'AUTH_EXPIRED' || error.code === 'CAPTCHA_REQUIRED' || error.code === 'TIMEOUT';
  }
}

function toRuntime(error: unknown, nodeId: string): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return new RuntimeError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error), { nodeId });
}

// TextToVideoExecutor (FG-1201) — resolves prompt + model config, calls the real
// provider adapter for Text-to-Video, polls to terminal state, returns video
// MediaRef. Modeled on ImageToVideoExecutor but consumes a prompt directly rather
// than an upstream image.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asText, mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { PollManager } from '../PollManager';
import { normalizeFlowUiModelLabel } from '../../shared/sync/SyncCapabilityRegistry';

export interface TextToVideoExecutorOptions {
  adapter: GoogleFlowAdapter;
  poller?: PollManager;
}

export class TextToVideoExecutor implements NodeExecutor {
  readonly kind = 't2v';
  private readonly adapter: GoogleFlowAdapter;
  private readonly poller: PollManager;

  constructor(options: TextToVideoExecutorOptions) {
    this.adapter = options.adapter;
    this.poller = options.poller ?? new PollManager();
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const prompt = asText(context.inputs.prompt) ?? String(context.config.promptSource === 'Custom' ? context.config.customPrompt ?? '' : '');
    if (!prompt) return { valid: false, errors: ['Text-to-Video requires a prompt input.'] };
    if (!context.config.model && !context.config.usageKey) return { valid: false, errors: ['Text-to-Video requires a model selection.'] };
    if (!context.context.activeProject.projectId) return { valid: false, errors: ['Text-to-Video requires an active project.'] };
    if (context.context.aborted) return { valid: false, errors: ['Run was cancelled.'] };
    return { valid: true, errors: [] };
  }

  async execute(context: NodeExecutionContext, abortSignal?: AbortSignal): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const prompt = asText(context.inputs.prompt) ?? String(context.config.promptSource === 'Custom' ? context.config.customPrompt ?? '' : '');
    if (!prompt) throw new RuntimeError('INVALID_INPUT', 'Text-to-Video received no prompt input.', { nodeId: context.nodeId });
    const projectId = context.context.activeProject.projectId;
    const modelKey = String(context.config.usageKey ?? context.config.model ?? 'veo_3_1_t2v_fast');

    let ref;
    try {
      ref = await this.adapter.generate({
        kind: 't2v',
        projectId,
        prompt: prompt || undefined,
        modelKey,
        modelLabel: context.config.model ? normalizeFlowUiModelLabel(String(context.config.model)) : undefined,
        aspectRatio: String(context.config.aspectRatio ?? '16:9 (Landscape)'),
        durationSeconds: context.config.duration !== undefined ? Number.parseInt(String(context.config.duration), 10) : undefined,
        targetResolution: context.config.targetResolution !== undefined || context.config.resolution !== undefined
          ? String(context.config.targetResolution ?? context.config.resolution)
          : undefined,
        seed: context.config.seed !== undefined ? Number(context.config.seed) : undefined,
      });
    } catch (error) {
      throw toRuntime(error, context.nodeId);
    }
    context.context.throwIfAborted();

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
  }

  retryable(error: { code: string }): boolean {
    return error.code === 'AUTH_EXPIRED' || error.code === 'CAPTCHA_REQUIRED' || error.code === 'TIMEOUT';
  }
}

function toRuntime(error: unknown, nodeId: string): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return new RuntimeError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error), { nodeId });
}

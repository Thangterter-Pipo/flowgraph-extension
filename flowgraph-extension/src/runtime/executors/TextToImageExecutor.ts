// TextToImageExecutor (FG-0602) — resolves prompt + model config, calls the real
// provider adapter, polls to terminal state, returns image MediaRef.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asText, mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { normalizeFlowUiModelLabel } from '../../shared/sync/SyncCapabilityRegistry';

export interface TextToImageExecutorOptions {
  adapter: GoogleFlowAdapter;
}

export class TextToImageExecutor implements NodeExecutor {
  readonly kind = 't2i';
  private readonly adapter: GoogleFlowAdapter;

  constructor(options: TextToImageExecutorOptions) {
    this.adapter = options.adapter;
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const prompt = asText(context.inputs.prompt) ?? String(context.config.promptSource === 'Custom' ? context.config.customPrompt ?? '' : '');
    if (!prompt) return { valid: false, errors: ['Text-to-Image requires a prompt input or custom prompt.'] };
    if (!context.config.model && !context.config.usageKey) return { valid: false, errors: ['Text-to-Image requires a model selection.'] };
    if (!context.context.activeProject.projectId) return { valid: false, errors: ['Text-to-Image requires an active project.'] };
    if (context.context.aborted) return { valid: false, errors: ['Run was cancelled.'] };
    return { valid: true, errors: [] };
  }

  async execute(context: NodeExecutionContext, _abortSignal?: AbortSignal): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const prompt = asText(context.inputs.prompt) ?? String(context.config.promptSource === 'Custom' ? context.config.customPrompt ?? '' : '');
    const projectId = context.context.activeProject.projectId;
    const modelKey = String(context.config.usageKey ?? context.config.model ?? 'NARWHAL');

    // Same reason as Image-to-Video: never let an empty prompt reach the Flow UI,
    // where it used to be silently replaced by a hard-coded placeholder.
    if (!prompt.trim()) {
      throw new RuntimeError('INVALID_INPUT', 'Text-to-Image received no prompt input. Connect a Prompt node to the Prompt input.', { nodeId: context.nodeId });
    }

    let ref;
    try {
      ref = await this.adapter.generate({
        kind: 't2i',
        projectId,
        prompt: prompt || undefined,
        modelKey,
        modelLabel: context.config.model ? normalizeFlowUiModelLabel(String(context.config.model)) : undefined,
        aspectRatio: String(context.config.aspectRatio ?? '16:9 (Landscape)'),
        // T2I không dùng targetResolution (độ phân giải video 360p/720p). Chỉ truyền khi thực sự cần.
        targetResolution: undefined,
        seed: context.config.seed !== undefined ? Number(context.config.seed) : undefined,
      });
    } catch (error) {
      throw toRuntime(error, context.nodeId);
    }
    context.context.throwIfAborted();

    // Text-to-Image is synchronous in the verified Flow API (image arrives in the
    // same 200 response), so no polling is required for V1. The previewUrl was
    // already resolved by the worker from the response fifeUrl.
    const previewUrl = ref.previewUrl || '';
    const media = mediaRefFromPayload({ ...ref, previewUrl });
    return {
      outputs: { image: media },
      result: {
        type: 'image',
        mediaId: ref.mediaId,
        previewUrl,
        mimeType: 'image/jpeg',
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

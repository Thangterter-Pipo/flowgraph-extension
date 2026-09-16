// GeminiEnhanceExecutor — calls the AI Gateway (gpt-5.6-luna / Gemini) to expand and enhance prompt text.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GeminiAdapter } from '../../adapters/gemini/GeminiAdapter';
import { textValue, asText } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export interface GeminiEnhanceExecutorOptions {
  adapter: GeminiAdapter;
}

export class GeminiEnhanceExecutor implements NodeExecutor {
  readonly kind = 'gemini';
  private adapter: GeminiAdapter;

  constructor(options: GeminiEnhanceExecutorOptions) {
    this.adapter = options.adapter;
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const prompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '').trim();
    if (!prompt) {
      return { valid: false, errors: ['Gemini Enhance requires an input prompt from a connected Prompt node or configured prompt.'] };
    }
    return { valid: true, errors: [] };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const prompt = asText(context.inputs.prompt) ?? String(context.config.prompt ?? '').trim();
    if (!prompt) {
      throw new RuntimeError('INVALID_INPUT', 'Gemini Enhance received no prompt text.', { nodeId: context.nodeId });
    }

    const style = (context.config.style || 'CINEMATIC') as any;
    const customInstruction = context.config.customInstruction || '';

    let enhanced: string;
    try {
      enhanced = await this.adapter.enhancePrompt(String(prompt), { style, customInstruction: String(customInstruction || '') });
    } catch (error) {
      throw new RuntimeError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error), { nodeId: context.nodeId });
    }

    context.context.throwIfAborted();

    return {
      outputs: {
        enhancedPrompt: textValue(enhanced),
        prompt: textValue(enhanced)
      },
      result: {
        type: 'text',
        previewUrl: '',
        text: enhanced
      } as any
    };
  }
}

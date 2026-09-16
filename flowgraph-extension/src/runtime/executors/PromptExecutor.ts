// PromptExecutor (FG-0601) — outputs text from a configured prompt (no provider call).
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { textValue } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export class PromptExecutor implements NodeExecutor {
  readonly kind = 'prompt';

  validate(context: NodeExecutionContext): ValidationResult {
    const prompt = String(context.config.prompt ?? '').trim();
    if (!prompt) return { valid: false, errors: ['Prompt is empty — provide a prompt in node configuration.'] };
    return { valid: true, errors: [] };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    const prompt = String(context.config.prompt ?? '').trim();
    if (!prompt) throw new RuntimeError('INVALID_INPUT', 'Prompt is empty', { nodeId: context.nodeId });
    return { outputs: { prompt: textValue(prompt) } };
  }
}

import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { RuntimeValue } from '../RuntimeValue';

export class SceneGroupExecutor implements NodeExecutor {
  readonly kind = 'sceneGroup';

  validate(_context: NodeExecutionContext): ValidationResult {
    return { valid: true, errors: [] };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    const sceneName = String(context.config.sceneName || 'Scene');
    const media = context.inputs.mediaIn;
    const outputs: Record<string, RuntimeValue> = {};
    if (media) {
      outputs.mediaOut = Array.isArray(media) ? media[0] : media;
    }
    return {
      outputs,
      result: {
        type: 'image',
        mediaId: `group-${context.nodeId}`,
        previewUrl: '',
        fileName: `${sceneName}.group`,
      },
    };
  }
}

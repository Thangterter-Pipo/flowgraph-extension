// ImageInputExecutor — injects existing project IMAGE MediaRef into workflow.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export class ImageInputExecutor implements NodeExecutor {
  readonly kind = 'imageInput';

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaId = String(context.config.mediaId ?? '').trim();
    const errors: string[] = [];

    if (!mediaId) {
      errors.push('Image Input requires a configured mediaId from the active project.');
    }

    if (!context.context.activeProject.projectId) {
      errors.push('Image Input requires an active project.');
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const mediaId = String(context.config.mediaId ?? '').trim();
    if (!mediaId) {
      throw new RuntimeError('INVALID_INPUT', 'Image Input has no configured mediaId.', { nodeId: context.nodeId });
    }

    const projectId = context.context.activeProject.projectId;
    const configProjectId = String(context.config.projectId ?? projectId).trim();
    if (configProjectId !== projectId) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Configured image belongs to project ${configProjectId}, not the active project ${projectId}.`,
        { nodeId: context.nodeId },
      );
    }

    const ref = {
      mediaId,
      projectId,
      type: 'IMAGE' as const,
      previewUrl: context.config.previewUrl ? String(context.config.previewUrl) : undefined,
    };

    const runtimeVal = mediaRefFromPayload(ref);
    return {
      outputs: {
        image: runtimeVal,
        media: runtimeVal,
      },
      result: {
        type: 'image',
        mediaId,
        previewUrl: ref.previewUrl ?? '',
      },
    };
  }
}

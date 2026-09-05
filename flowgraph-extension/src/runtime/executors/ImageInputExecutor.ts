// ImageInputExecutor — injects existing project IMAGE MediaRef into workflow.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export class ImageInputExecutor implements NodeExecutor {
  readonly kind = 'imageInput';

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaId = String(context.config.mediaId ?? '').trim();
    const configProjectId = String(context.config.projectId ?? '').trim();
    const errors: string[] = [];

    if (!mediaId) {
      errors.push('Image Input requires a configured mediaId from the active project.');
    }

    if (!configProjectId) {
      errors.push('Image Input requires explicit projectId provenance in its configuration.');
    }

    const activeProject = context.context.activeProject.projectId;
    if (!activeProject) {
      errors.push('Image Input requires an active project.');
    } else if (configProjectId && configProjectId !== activeProject) {
      errors.push(`Configured image projectId ${configProjectId} does not match active project ${activeProject}.`);
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const mediaId = String(context.config.mediaId ?? '').trim();
    if (!mediaId) {
      throw new RuntimeError('INVALID_INPUT', 'Image Input has no configured mediaId.', { nodeId: context.nodeId });
    }

    const activeProject = context.context.activeProject.projectId;
    const configProjectId = String(context.config.projectId ?? '').trim();
    if (!configProjectId) {
      throw new RuntimeError('INVALID_INPUT', 'Image Input missing explicit projectId provenance.', { nodeId: context.nodeId });
    }

    if (configProjectId !== activeProject) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Configured image belongs to project ${configProjectId}, not the active project ${activeProject}.`,
        { nodeId: context.nodeId },
      );
    }

    // Do NOT store signed URLs in config — only transient runtime reference
    const ref = {
      mediaId,
      projectId: activeProject,
      type: 'IMAGE' as const,
      previewUrl: undefined,
    };

    const runtimeVal = mediaRefFromPayload(ref);
    return {
      outputs: {
        image: runtimeVal,
      },
      result: {
        type: 'image',
        mediaId,
        previewUrl: '',
      },
    };
  }
}

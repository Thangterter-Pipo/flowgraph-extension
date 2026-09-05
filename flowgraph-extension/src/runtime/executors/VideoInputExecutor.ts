// VideoInputExecutor — injects existing project VIDEO MediaRef into workflow.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export class VideoInputExecutor implements NodeExecutor {
  readonly kind = 'videoInput';

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaId = String(context.config.mediaId ?? '').trim();
    const configProjectId = String(context.config.projectId ?? '').trim();
    const mediaType = String(context.config.mediaType ?? context.config.type ?? 'VIDEO').toUpperCase();
    const errors: string[] = [];

    if (!mediaId) {
      errors.push('Video Input requires a configured mediaId from the active project.');
    }

    if (mediaType && mediaType !== 'VIDEO') {
      errors.push(`Video Input cannot accept mediaType "${mediaType}". Must strictly be "VIDEO".`);
    }

    if (!configProjectId) {
      errors.push('Video Input requires explicit projectId provenance in its configuration.');
    }

    const activeProject = context.context.activeProject.projectId;
    if (!activeProject) {
      errors.push('Video Input requires an active project.');
    } else if (configProjectId && configProjectId !== activeProject) {
      errors.push(`Configured video projectId ${configProjectId} does not match active project ${activeProject}.`);
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const mediaId = String(context.config.mediaId ?? '').trim();
    if (!mediaId) {
      throw new RuntimeError('INVALID_INPUT', 'Video Input has no configured mediaId.', { nodeId: context.nodeId });
    }

    const mediaType = String(context.config.mediaType ?? context.config.type ?? 'VIDEO').toUpperCase();
    if (mediaType !== 'VIDEO') {
      throw new RuntimeError('INVALID_INPUT', `Video Input received mediaType "${mediaType}", expected VIDEO.`, { nodeId: context.nodeId });
    }

    const activeProject = context.context.activeProject.projectId;
    const configProjectId = String(context.config.projectId ?? '').trim();
    if (!configProjectId) {
      throw new RuntimeError('INVALID_INPUT', 'Video Input missing explicit projectId provenance.', { nodeId: context.nodeId });
    }

    if (configProjectId !== activeProject) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Configured video belongs to project ${configProjectId}, not the active project ${activeProject}.`,
        { nodeId: context.nodeId },
      );
    }

    // Do NOT store signed URLs in config — only transient runtime reference
    const ref = {
      mediaId,
      projectId: activeProject,
      type: 'VIDEO' as const,
      previewUrl: undefined,
    };

    const runtimeVal = mediaRefFromPayload(ref);
    return {
      outputs: {
        video: runtimeVal,
      },
      result: {
        type: 'video',
        mediaId,
        previewUrl: '',
      },
    };
  }
}

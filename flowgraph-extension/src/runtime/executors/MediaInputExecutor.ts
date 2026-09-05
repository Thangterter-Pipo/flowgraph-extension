// MediaInputExecutor — injects existing project MediaRef (IMAGE or VIDEO) into workflow.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export class MediaInputExecutor implements NodeExecutor {
  readonly kind = 'mediaInput';

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaId = String(context.config.mediaId ?? '').trim();
    const mediaType = String(context.config.mediaType ?? context.config.type ?? '').toUpperCase();
    const configProjectId = String(context.config.projectId ?? '').trim();
    const errors: string[] = [];

    if (!mediaId) {
      errors.push('Media Input requires a configured mediaId from the active project.');
    }

    if (!mediaType || (mediaType !== 'IMAGE' && mediaType !== 'VIDEO')) {
      errors.push(`Invalid or missing mediaType "${mediaType}". Must strictly be "IMAGE" or "VIDEO".`);
    }

    if (!configProjectId) {
      errors.push('Media Input requires an explicit projectId provenance in its configuration.');
    }

    const activeProject = context.context.activeProject.projectId;
    if (!activeProject) {
      errors.push('Media Input requires an active project.');
    } else if (configProjectId && configProjectId !== activeProject) {
      errors.push(`Configured media projectId ${configProjectId} does not match active project ${activeProject}.`);
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const mediaId = String(context.config.mediaId ?? '').trim();
    if (!mediaId) {
      throw new RuntimeError('INVALID_INPUT', 'Media Input has no configured mediaId.', { nodeId: context.nodeId });
    }

    const mediaType = String(context.config.mediaType ?? context.config.type ?? '').toUpperCase() as 'IMAGE' | 'VIDEO';
    if (mediaType !== 'IMAGE' && mediaType !== 'VIDEO') {
      throw new RuntimeError('INVALID_INPUT', `Invalid mediaType "${mediaType}". Must strictly be "IMAGE" or "VIDEO".`, { nodeId: context.nodeId });
    }

    const activeProject = context.context.activeProject.projectId;
    const configProjectId = String(context.config.projectId ?? '').trim();
    if (!configProjectId) {
      throw new RuntimeError('INVALID_INPUT', 'Media Input missing explicit projectId provenance.', { nodeId: context.nodeId });
    }

    if (configProjectId !== activeProject) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Configured media belongs to project ${configProjectId}, not the active project ${activeProject}.`,
        { nodeId: context.nodeId },
      );
    }

    // Do NOT store signed URLs in config — only transient runtime reference
    const ref = {
      mediaId,
      projectId: activeProject,
      type: mediaType,
      previewUrl: undefined,
    };

    const runtimeVal = mediaRefFromPayload(ref);
    return {
      outputs: {
        media: runtimeVal,
      },
      result: {
        type: mediaType === 'IMAGE' ? 'image' : 'video',
        mediaId,
        previewUrl: '',
      },
    };
  }
}

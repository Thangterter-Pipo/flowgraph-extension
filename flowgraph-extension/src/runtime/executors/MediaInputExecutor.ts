// MediaInputExecutor — injects existing project MediaRef (IMAGE or VIDEO) into workflow.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export class MediaInputExecutor implements NodeExecutor {
  readonly kind = 'mediaInput';

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaId = String(context.config.mediaId ?? '').trim();
    const mediaType = String(context.config.mediaType ?? context.config.type ?? 'IMAGE').toUpperCase();
    const errors: string[] = [];

    if (!mediaId) {
      errors.push('Media Input requires a configured mediaId from the active project.');
    }

    if (mediaType !== 'IMAGE' && mediaType !== 'VIDEO') {
      errors.push(`Invalid mediaType "${mediaType}". Must be "IMAGE" or "VIDEO".`);
    }

    if (!context.context.activeProject.projectId) {
      errors.push('Media Input requires an active project.');
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const mediaId = String(context.config.mediaId ?? '').trim();
    if (!mediaId) {
      throw new RuntimeError('INVALID_INPUT', 'Media Input has no configured mediaId.', { nodeId: context.nodeId });
    }

    const mediaType = String(context.config.mediaType ?? context.config.type ?? 'IMAGE').toUpperCase() as 'IMAGE' | 'VIDEO';
    if (mediaType !== 'IMAGE' && mediaType !== 'VIDEO') {
      throw new RuntimeError('INVALID_INPUT', `Invalid mediaType "${mediaType}". Must be "IMAGE" or "VIDEO".`, { nodeId: context.nodeId });
    }

    const projectId = context.context.activeProject.projectId;
    const configProjectId = String(context.config.projectId ?? projectId).trim();
    if (configProjectId !== projectId) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Configured media belongs to project ${configProjectId}, not the active project ${projectId}.`,
        { nodeId: context.nodeId },
      );
    }

    const ref = {
      mediaId,
      projectId,
      type: mediaType,
      previewUrl: context.config.previewUrl ? String(context.config.previewUrl) : undefined,
    };

    const runtimeVal = mediaRefFromPayload(ref);
    return {
      outputs: {
        media: runtimeVal,
        [mediaType === 'IMAGE' ? 'image' : 'video']: runtimeVal,
      },
      result: {
        type: mediaType === 'IMAGE' ? 'image' : 'video',
        mediaId,
        previewUrl: ref.previewUrl ?? '',
      },
    };
  }
}

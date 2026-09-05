// PreviewExecutor — displays upstream IMAGE or VIDEO MediaRef and passes it through.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { asMedia, mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export class PreviewExecutor implements NodeExecutor {
  readonly kind = 'preview';

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaInput = context.inputs.media ?? context.inputs.image ?? context.inputs.video;
    const errors: string[] = [];

    if (!mediaInput) {
      errors.push('Preview requires an image, video, or media input connected.');
    } else {
      const mediaRef = asMedia(mediaInput);
      if (!mediaRef || !mediaRef.mediaId) {
        errors.push('Preview input must strictly be a valid MediaRef.');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const mediaInput = context.inputs.media ?? context.inputs.image ?? context.inputs.video;
    const mediaRef = asMedia(mediaInput);
    if (!mediaRef) {
      throw new RuntimeError('INVALID_INPUT', 'Preview received no valid media input.', { nodeId: context.nodeId });
    }

    const projectId = context.context.activeProject.projectId;
    if (mediaRef.projectId !== projectId) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Preview media ${mediaRef.mediaId} belongs to project ${mediaRef.projectId}, not the active project ${projectId}.`,
        { nodeId: context.nodeId },
      );
    }

    const runtimeVal = mediaRefFromPayload(mediaRef);
    return {
      outputs: {
        media: runtimeVal,
        [mediaRef.type.toLowerCase()]: runtimeVal,
      },
      result: {
        type: mediaRef.type === 'IMAGE' ? 'image' : 'video',
        mediaId: mediaRef.mediaId,
        previewUrl: mediaRef.previewUrl ?? '',
      },
    };
  }
}

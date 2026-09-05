// PreviewExecutor — displays upstream IMAGE or VIDEO MediaRef and passes it through via typed MEDIA port.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asMedia, mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

export interface PreviewExecutorOptions {
  adapter?: GoogleFlowAdapter;
}

export class PreviewExecutor implements NodeExecutor {
  readonly kind = 'preview';
  private readonly adapter?: GoogleFlowAdapter;

  constructor(options?: PreviewExecutorOptions) {
    this.adapter = options?.adapter;
  }

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

    let transientPreviewUrl = mediaRef.previewUrl;
    // Transient resolution: if previewUrl is missing from upstream MediaRef (e.g. from ImageInput/VideoInput),
    // resolve it dynamically via adapter without persisting it into config.
    if (!transientPreviewUrl && this.adapter) {
      try {
        transientPreviewUrl = await this.adapter.resolvePreviewUrl(mediaRef.mediaId, projectId);
      } catch {
        // Best-effort transient resolution
      }
    }

    const resolvedRef = {
      ...mediaRef,
      previewUrl: transientPreviewUrl,
    };

    const runtimeVal = mediaRefFromPayload(resolvedRef);
    return {
      outputs: {
        media: runtimeVal,
      },
      result: {
        type: mediaRef.type === 'IMAGE' ? 'image' : 'video',
        mediaId: mediaRef.mediaId,
        previewUrl: transientPreviewUrl ?? '',
      },
    };
  }
}

// ImageInputExecutor — Flow IMAGE bind, or local PNG/JPEG upload on Run.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { trustedProjectIdForProviderMedia, isLocalMediaKey } from '../mediaProvenance';
import { UploadImageExecutor } from './UploadImageExecutor';

export class ImageInputExecutor implements NodeExecutor {
  readonly kind = 'imageInput';
  private readonly upload?: UploadImageExecutor;

  constructor(options?: { adapter?: GoogleFlowAdapter }) {
    this.upload = options?.adapter ? new UploadImageExecutor({ adapter: options.adapter }) : undefined;
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaId = String(context.config.mediaId ?? '').trim();
    if (mediaId && isLocalMediaKey(mediaId)) {
      if (!this.upload) {
        return { valid: false, errors: ['Local image upload requires the Flow adapter.'] };
      }
      return this.upload.validate(context);
    }

    const configProjectId = String(context.config.projectId ?? '').trim();
    const rawMediaType = context.config.mediaType ?? context.config.type;
    const mediaType = rawMediaType ? String(rawMediaType).trim().toUpperCase() : '';
    const errors: string[] = [];

    if (!mediaId) {
      errors.push('Image Input needs a local PNG/JPEG or a Flow image.');
    }

    if (!mediaType) {
      errors.push('Image Input requires an explicit mediaType: "IMAGE".');
    } else if (mediaType !== 'IMAGE') {
      errors.push(`Image Input cannot accept mediaType "${mediaType}". Must strictly be "IMAGE".`);
    }

    if (!configProjectId) {
      errors.push('Image Input requires explicit projectId provenance in its configuration.');
    }

    const activeProject = context.context.activeProject.projectId;
    if (!activeProject) {
      errors.push('Image Input requires an active project.');
    } else if (configProjectId) {
      const provenance = trustedProjectIdForProviderMedia({
        configProjectId,
        activeProjectId: activeProject,
        mediaId,
      });
      if (!provenance.ok) {
        errors.push(provenance.message);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const mediaId = String(context.config.mediaId ?? '').trim();
    if (!mediaId) {
      throw new RuntimeError('INVALID_INPUT', 'Image Input has no configured mediaId.', { nodeId: context.nodeId });
    }
    if (isLocalMediaKey(mediaId)) {
      if (!this.upload) {
        throw new RuntimeError('INVALID_INPUT', 'Local image upload requires the Flow adapter.', { nodeId: context.nodeId });
      }
      return this.upload.execute(context);
    }

    const rawMediaType = context.config.mediaType ?? context.config.type;
    const mediaType = rawMediaType ? String(rawMediaType).trim().toUpperCase() : '';
    if (!mediaType) {
      throw new RuntimeError('INVALID_INPUT', 'Image Input missing explicit mediaType configuration.', { nodeId: context.nodeId });
    }
    if (mediaType !== 'IMAGE') {
      throw new RuntimeError('INVALID_INPUT', `Image Input received mediaType "${mediaType}", expected IMAGE.`, { nodeId: context.nodeId });
    }

    const provenance = trustedProjectIdForProviderMedia({
      configProjectId: String(context.config.projectId ?? '').trim(),
      activeProjectId: context.context.activeProject.projectId,
      mediaId,
    });
    if (!provenance.ok) {
      throw new RuntimeError(provenance.code, provenance.message, { nodeId: context.nodeId });
    }

    const ref = {
      mediaId,
      projectId: provenance.projectId,
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
        projectId: provenance.projectId,
      },
    };
  }
}

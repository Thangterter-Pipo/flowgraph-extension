// MediaInputExecutor — injects existing project MediaRef (IMAGE or VIDEO) into workflow.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { trustedProjectIdForProviderMedia, isLocalMediaKey } from '../mediaProvenance';

export class MediaInputExecutor implements NodeExecutor {
  readonly kind = 'mediaInput';

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaId = String(context.config.mediaId ?? '').trim();
    const mediaType = String(context.config.mediaType ?? context.config.type ?? '').toUpperCase();
    const configProjectId = String(context.config.projectId ?? '').trim();
    const errors: string[] = [];

    if (!mediaId) {
      errors.push('Media Input requires a configured mediaId from the active project.');
    } else if (isLocalMediaKey(mediaId)) {
      errors.push('Local files are not provider media. Use Upload Image.');
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
      throw new RuntimeError('INVALID_INPUT', 'Media Input has no configured mediaId.', { nodeId: context.nodeId });
    }
    if (isLocalMediaKey(mediaId)) {
      throw new RuntimeError('INVALID_INPUT', 'Local files are not provider media. Use Upload Image.', { nodeId: context.nodeId });
    }

    const mediaType = String(context.config.mediaType ?? context.config.type ?? '').toUpperCase() as 'IMAGE' | 'VIDEO';
    if (mediaType !== 'IMAGE' && mediaType !== 'VIDEO') {
      throw new RuntimeError('INVALID_INPUT', `Invalid mediaType "${mediaType}". Must strictly be "IMAGE" or "VIDEO".`, { nodeId: context.nodeId });
    }

    const provenance = trustedProjectIdForProviderMedia({
      configProjectId: String(context.config.projectId ?? '').trim(),
      activeProjectId: context.context.activeProject.projectId,
      mediaId,
    });
    if (!provenance.ok) {
      throw new RuntimeError(provenance.code, provenance.message, { nodeId: context.nodeId });
    }

    // Do NOT store signed URLs in config — only transient runtime reference
    const ref = {
      mediaId,
      projectId: provenance.projectId,
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

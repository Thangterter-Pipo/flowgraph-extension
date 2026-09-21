// VideoInputExecutor — injects existing project VIDEO MediaRef into workflow.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { trustedProjectIdForProviderMedia, isLocalMediaKey } from '../mediaProvenance';

export class VideoInputExecutor implements NodeExecutor {
  readonly kind = 'videoInput';

  validate(context: NodeExecutionContext): ValidationResult {
    const mediaId = String(context.config.mediaId ?? '').trim();
    const configProjectId = String(context.config.projectId ?? '').trim();
    const rawMediaType = context.config.mediaType ?? context.config.type;
    const mediaType = rawMediaType ? String(rawMediaType).trim().toUpperCase() : '';
    const errors: string[] = [];

    if (!mediaId) {
      errors.push('Video Input requires a configured mediaId from the active project.');
    } else if (isLocalMediaKey(mediaId)) {
      errors.push('Local video upload is not runtime-verified. Bind an existing Flow video.');
    }

    if (!mediaType) {
      errors.push('Video Input requires an explicit mediaType: "VIDEO".');
    } else if (mediaType !== 'VIDEO') {
      errors.push(`Video Input cannot accept mediaType "${mediaType}". Must strictly be "VIDEO".`);
    }

    if (!configProjectId) {
      errors.push('Video Input requires explicit projectId provenance in its configuration.');
    }

    const activeProject = context.context.activeProject.projectId;
    if (!activeProject) {
      errors.push('Video Input requires an active project.');
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
      throw new RuntimeError('INVALID_INPUT', 'Video Input has no configured mediaId.', { nodeId: context.nodeId });
    }
    if (isLocalMediaKey(mediaId)) {
      throw new RuntimeError('INVALID_INPUT', 'Local video upload is not runtime-verified. Bind an existing Flow video.', { nodeId: context.nodeId });
    }

    const rawMediaType = context.config.mediaType ?? context.config.type;
    const mediaType = rawMediaType ? String(rawMediaType).trim().toUpperCase() : '';
    if (!mediaType) {
      throw new RuntimeError('INVALID_INPUT', 'Video Input missing explicit mediaType configuration.', { nodeId: context.nodeId });
    }
    if (mediaType !== 'VIDEO') {
      throw new RuntimeError('INVALID_INPUT', `Video Input received mediaType "${mediaType}", expected VIDEO.`, { nodeId: context.nodeId });
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

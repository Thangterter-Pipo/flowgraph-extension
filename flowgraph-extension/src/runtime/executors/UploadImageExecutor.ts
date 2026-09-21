// UploadImageExecutor — turns a locally dropped image into a real Flow MediaRef.
// The upload path (FLOWGRAPH_MEDIA_UPLOAD → flow/uploadImage) already existed in
// the adapter; only the node executor was missing, which made every upload-based
// template fail validation with UNSUPPORTED_NODE before a single request ran.
//
// Contract with the Studio UI: dropping an image file onto the canvas (or onto a
// node card) stores the data URL in IndexedDB under `local-<id>` / `dropped-<id>`
// and records that key in config.mediaId. This executor reads the blob back,
// uploads it to the active project, and outputs the provider mediaId downstream.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { getMediaBlob } from '../../ui/studio/mediaStorage';
import { isLocalMediaKey, trustedProjectIdForProviderMedia } from '../mediaProvenance';

export interface UploadImageExecutorOptions {
  adapter: GoogleFlowAdapter;
}

export { isLocalMediaKey };

export class UploadImageExecutor implements NodeExecutor {
  readonly kind = 'uploadImage';
  private readonly adapter: GoogleFlowAdapter;

  constructor(options: UploadImageExecutorOptions) {
    this.adapter = options.adapter;
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const errors: string[] = [];
    const mediaId = String(context.config.mediaId ?? '').trim();
    if (!mediaId) {
      errors.push('Upload Image has no image yet — drag a PNG/JPEG file onto the node (or the canvas) first.');
    }
    if (!context.context.activeProject.projectId) {
      errors.push('Upload Image requires an active project.');
    }
    if (mediaId && !isLocalMediaKey(mediaId)) {
      const provenance = trustedProjectIdForProviderMedia({
        configProjectId: String(context.config.projectId ?? '').trim(),
        activeProjectId: context.context.activeProject.projectId,
        mediaId,
      });
      if (!provenance.ok) {
        errors.push(provenance.message);
      }
    }
    if (context.context.aborted) errors.push('Run was cancelled.');
    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const mediaId = String(context.config.mediaId ?? '').trim();
    const projectId = context.context.activeProject.projectId;
    if (!mediaId) {
      throw new RuntimeError('INVALID_INPUT', 'Upload Image has no local image attached.', { nodeId: context.nodeId });
    }
    if (!projectId) {
      throw new RuntimeError('INVALID_INPUT', 'Upload Image requires an active project.', { nodeId: context.nodeId });
    }

    if (isLocalMediaKey(mediaId)) {
      return this.uploadLocalImage(context, mediaId, projectId);
    }

    const provenance = trustedProjectIdForProviderMedia({
      configProjectId: String(context.config.projectId ?? '').trim(),
      activeProjectId: projectId,
      mediaId,
    });
    if (!provenance.ok) {
      throw new RuntimeError(provenance.code, provenance.message, { nodeId: context.nodeId });
    }

    const passthrough = mediaRefFromPayload({ mediaId, projectId: provenance.projectId, type: 'IMAGE' });
    return {
      outputs: { image: passthrough },
      result: { type: 'image', mediaId, previewUrl: '', mimeType: 'image/jpeg' },
    };
  }

  private async uploadLocalImage(
    context: NodeExecutionContext,
    mediaId: string,
    projectId: string,
  ): Promise<NodeExecutorOutput> {
    const dataUrl = await getMediaBlob(mediaId);
    if (!dataUrl) {
      throw new RuntimeError(
        'INVALID_INPUT',
        `Local image "${mediaId}" is no longer in the media cache. Re-drop the file onto the node.`,
        { nodeId: context.nodeId },
      );
    }

    const match = /^data:([^;,]+)[^,]*,(.*)$/s.exec(dataUrl);
    if (!match) {
      throw new RuntimeError('INVALID_INPUT', 'Stored image is not a readable data URL.', { nodeId: context.nodeId });
    }
    const mimeType = match[1];
    const imageBytesBase64 = match[2];
    const fileName = String(context.config.fileName ?? mediaId.replace(/[^a-z0-9\-_.]/gi, '') ?? 'upload');

    let ref;
    try {
      ref = await this.adapter.uploadImage({ projectId, imageBytesBase64, mimeType, fileName });
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error), { nodeId: context.nodeId });
    }
    context.context.throwIfAborted();

    let previewUrl = '';
    try {
      previewUrl = (await this.adapter.resolvePreviewUrl(ref.mediaId, projectId)) ?? '';
    } catch {
      // Preview resolution is cosmetic — the uploaded mediaId is what downstream nodes need.
    }

    const media = mediaRefFromPayload({ ...ref, previewUrl: previewUrl || undefined });
    return {
      outputs: { image: media },
      result: {
        type: 'image',
        mediaId: ref.mediaId,
        previewUrl,
        mimeType,
        fileName,
      },
    };
  }

  /** Local cache misses are permanent for this run; provider/auth blips are worth another attempt. */
  retryable(error: { code: string }): boolean {
    return error.code === 'AUTH_EXPIRED' || error.code === 'CAPTCHA_REQUIRED' || error.code === 'TIMEOUT' || error.code === 'PROVIDER_ERROR';
  }
}

// ImageUpscaleExecutor — consumes upstream IMAGE MediaRef,
// requests 2K or 4K Image Upsampling from Google Flow, returns upscaled IMAGE MediaRef.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { mediaRefFromPayload } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { generateCancellable } from './generateCancellable';

export interface ImageUpscaleExecutorOptions {
  adapter: GoogleFlowAdapter;
}

export class ImageUpscaleExecutor implements NodeExecutor {
  readonly kind = 'imageUpscale';
  private readonly adapter: GoogleFlowAdapter;

  constructor(options: ImageUpscaleExecutorOptions) {
    this.adapter = options.adapter;
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const imageInput = context.inputs.image;
    const targetResolution = String(context.config.targetResolution ?? context.config.resolution ?? '2K');
    const errors: string[] = [];

    if (!imageInput) {
      errors.push('Image Upscale requires an image connected to the Image input.');
    } else {
      const val = Array.isArray(imageInput) ? imageInput[0] : imageInput;
      if (val.type !== 'image' || !val.value || typeof val.value !== 'object' || !('mediaId' in val.value) || !(val.value as any).mediaId) {
        errors.push('Image Upscale input must strictly be a valid IMAGE MediaRef.');
      }
    }

    if (targetResolution !== '2K' && targetResolution !== '4K' && targetResolution !== 'UPSAMPLE_IMAGE_RESOLUTION_2K' && targetResolution !== 'UPSAMPLE_IMAGE_RESOLUTION_4K') {
      errors.push(`Invalid targetResolution "${targetResolution}". Must be "2K" or "4K".`);
    }

    if (!context.context.activeProject.projectId) {
      errors.push('Image Upscale requires an active project.');
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: NodeExecutionContext, abortSignal?: AbortSignal): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const imageInput = context.inputs.image;
    if (!imageInput) {
      throw new RuntimeError('INVALID_INPUT', 'Image Upscale received no image input.', { nodeId: context.nodeId });
    }

    const val = Array.isArray(imageInput) ? imageInput[0] : imageInput;
    if (val.type !== 'image' || !val.value || typeof val.value !== 'object' || !('mediaId' in val.value)) {
      throw new RuntimeError('INVALID_INPUT', 'Image Upscale input must strictly be an IMAGE MediaRef.', { nodeId: context.nodeId });
    }

    const refImage = val.value as { mediaId?: string; projectId?: string; type?: string };
    if (!refImage.mediaId || !refImage.mediaId.trim()) {
      throw new RuntimeError('INVALID_INPUT', 'Image input has empty mediaId.', { nodeId: context.nodeId });
    }

    if (refImage.type !== 'IMAGE') {
      throw new RuntimeError('INVALID_INPUT', `Image input ${refImage.mediaId} is of type ${refImage.type}, expected IMAGE.`, { nodeId: context.nodeId });
    }

    const projectId = context.context.activeProject.projectId;
    if (refImage.projectId !== projectId) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Input Image ${refImage.mediaId} belongs to project ${refImage.projectId}, not the active project ${projectId}.`,
        { nodeId: context.nodeId },
      );
    }

    let targetResolution = String(context.config.targetResolution ?? context.config.resolution ?? '2K');
    if (targetResolution === '2K') targetResolution = 'UPSAMPLE_IMAGE_RESOLUTION_2K';
    if (targetResolution === '4K') targetResolution = 'UPSAMPLE_IMAGE_RESOLUTION_4K';

    const modelKey = targetResolution === 'UPSAMPLE_IMAGE_RESOLUTION_4K' ? 'GEM_PIX_2_UPSAMPLE_4K' : 'GEM_PIX_2_UPSAMPLE_2K';

    let result;
    try {
      result = await generateCancellable(this.adapter, {
        kind: 'imageUpscale' as any,
        projectId,
        modelKey,
        targetResolution,
        imageRefs: [{ mediaId: refImage.mediaId }],
      }, context.context, abortSignal);
    } catch (err) {
      throw toRuntimeError(err, context.nodeId);
    }

    context.context.throwIfAborted();
    const previewUrl = result.previewUrl;
    return {
      outputs: {
        image: mediaRefFromPayload({
          ...result,
          previewUrl,
          type: 'IMAGE',
        }),
      },
      result: {
        type: 'image',
        mediaId: result.mediaId,
        previewUrl: previewUrl ?? '',
        mimeType: 'image/jpeg',
      },
    };
  }

  retryable(error: RuntimeError): boolean {
    return error.code === 'AUTH_EXPIRED' || error.code === 'CAPTCHA_REQUIRED' || error.code === 'TIMEOUT';
  }
}

function toRuntimeError(err: unknown, nodeId: string): RuntimeError {
  if (err instanceof RuntimeError) return err;
  return new RuntimeError('PROVIDER_ERROR', err instanceof Error ? err.message : String(err), { nodeId });
}

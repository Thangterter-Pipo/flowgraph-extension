// DownloadExecutor (FG-0604) — downloads the upstream media artifact to the user's
// machine. Success only when the browser download completes (or at least starts
// with a provider-confirmed file). Never fakes success.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asMedia } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { isStitchArtifact, stitchArtifactUrl } from '../stitch/StitchArtifactStore';

export interface DownloadExecutorOptions {
  adapter: GoogleFlowAdapter;
}

export class DownloadExecutor implements NodeExecutor {
  readonly kind = 'download';
  private readonly adapter: GoogleFlowAdapter;

  constructor(options: DownloadExecutorOptions) {
    this.adapter = options.adapter;
  }

  validate(context: NodeExecutionContext): ValidationResult {
    const media = asMedia(context.inputs.media);
    if (!media) return { valid: false, errors: ['Download requires a media input from a connected node.'] };
    return { valid: true, errors: [] };
  }

  async execute(context: NodeExecutionContext): Promise<NodeExecutorOutput> {
    context.context.throwIfAborted();
    const media = asMedia(context.inputs.media);
    if (!media) throw new RuntimeError('INVALID_INPUT', 'Download received no media input.', { nodeId: context.nodeId });

    const activeProject = context.context.activeProject.projectId;
    if (!media.projectId || media.projectId !== activeProject) {
      throw new RuntimeError(
        'PROJECT_ISOLATION',
        `Download media belongs to project ${media.projectId ?? 'none'}, not the active project ${activeProject}.`,
        { nodeId: context.nodeId },
      );
    }

    const fileName = String(context.config.fileName ?? `flowgraph-${media.mediaId.slice(0, 8)}`);
    if (isStitchArtifact(media.mediaId)) {
      const previewUrl = await stitchArtifactUrl(media.mediaId, activeProject);
      return { outputs: { file: { type: 'file', value: media.mediaId } },
        result: { type: 'video', mediaId: media.mediaId, projectId: activeProject, previewUrl, mimeType: media.mimeType } };
    }

    // Bố yêu cầu: Không tự động tải xuống file về máy khi hoàn thành video
    // Chỉ tải khi autoDownload === 'true', tránh làm phiền và spam popup browser download
    const autoDownload = context.config.autoDownload === 'true';
    let savedFilename = fileName;

    if (autoDownload) {
      const result = await this.adapter.downloadMedia({
        mediaId: media.mediaId,
        projectId: media.projectId,
        fileName,
        mediaType: media.type,
        url: media.previewUrl,
      });
      if (!result.ok) {
        throw new RuntimeError('MEDIA_FAILED', result.error ?? 'Download failed.', { nodeId: context.nodeId });
      }
      if (result.filename) savedFilename = result.filename;
    }

    return {
      outputs: {
        file: {
          type: 'file' as const,
          value: savedFilename,
        },
      },
      result: {
        type: media.type === 'VIDEO' ? 'video' : 'image',
        mediaId: media.mediaId,
        previewUrl: media.previewUrl ?? '',
      },
    };
  }
}

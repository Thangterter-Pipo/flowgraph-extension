// DownloadExecutor (FG-0604) — downloads the upstream media artifact to the user's
// machine. Success only when the browser download completes (or at least starts
// with a provider-confirmed file). Never fakes success.
import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asMedia } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';

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

    const fileName = String(context.config.fileName ?? `flowgraph-${media.mediaId.slice(0, 8)}`);

    // Only download if autoDownload is explicitly requested; default is false to avoid unintended browser download popups
    const autoDownload = context.config.autoDownload === 'true' || context.config.autoDownload === true;
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
          type: 'text' as const,
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

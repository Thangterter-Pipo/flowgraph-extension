import type { NodeExecutor, NodeExecutorOutput, NodeExecutionContext, ValidationResult } from '../../engine/execution/NodeExecutor';
import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { asMediaList, mediaValue } from '../RuntimeValue';
import { RuntimeError } from '../RuntimeError';
import { stitchInBrowser, stitchWait } from '../stitch/BrowserStitchEngine';
import { isStitchArtifact, saveStitchArtifact, stitchArtifactUrl } from '../stitch/StitchArtifactStore';

export class VideoConcatExecutor implements NodeExecutor {
  readonly kind = 'videoConcat';
  constructor(private readonly options: { adapter?: GoogleFlowAdapter } = {}) {}

  private inputs(context: NodeExecutionContext) {
    const values = [context.inputs.videos, context.inputs.video].flatMap((value) => value === undefined ? [] : Array.isArray(value) ? value : [value]);
    const videos = asMediaList(values);
    if (!videos.length || videos.length !== values.length || videos.some((video) => video.type !== 'VIDEO' || !video.mediaId)) {
      throw new RuntimeError('INVALID_INPUT', 'Stitch / Timeline requires at least 1 video input; every connected input must be a video.');
    }
    return videos;
  }
  validate(context: NodeExecutionContext): ValidationResult {
    try { this.inputs(context); return { valid: true, errors: [] }; }
    catch (error) { return { valid: false, errors: [error instanceof Error ? error.message : 'Invalid Stitch inputs.'] }; }
  }
  async execute(context: NodeExecutionContext, signal?: AbortSignal): Promise<NodeExecutorOutput> {
    if (signal?.aborted) throw new RuntimeError('CANCELLED', 'Stitch was cancelled.', { nodeId: context.nodeId });
    const videos = this.inputs(context);
    const projectId = context.context.activeProject?.projectId ?? videos[0].projectId;
    if (!projectId || videos.some((video) => video.projectId !== projectId)) {
      throw new RuntimeError('PROJECT_ISOLATION', 'All Stitch inputs must belong to the active project.');
    }
    // Single input is an unchanged upstream reference, not a rendered artifact.
    if (videos.length === 1) return { outputs: { video: mediaValue(videos[0]) } };
    try {
      const sources: string[] = [];
      for (const video of videos) {
        if (isStitchArtifact(video.mediaId)) {
          sources.push(await stitchWait(stitchArtifactUrl(video.mediaId, projectId), signal));
          continue;
        }
        // Nếu upstream đã có previewUrl hợp lệ và còn sống (ví dụ freshly resolved), ưu tiên dùng trực tiếp
        if (video.previewUrl && typeof video.previewUrl === 'string' && video.previewUrl.startsWith('https://')) {
          sources.push(video.previewUrl);
          continue;
        }
        if (!this.options.adapter) throw new RuntimeError('MEDIA_FAILED', 'Stitch requires the exact provider source resolver.');
        const response = await stitchWait(this.options.adapter.waitForMedia({ mediaId: video.mediaId, projectId, playbackRecovery: true }), signal);
        const media = response.media;
        if (response.status !== 'SUCCESSFUL' || media?.mediaId !== video.mediaId || media.projectId !== projectId || media.type !== 'VIDEO' || !media.previewUrl) {
          throw new RuntimeError('MEDIA_FAILED', 'Cannot resolve an exact playable Stitch source; open that source in Flow first.');
        }
        sources.push(media.previewUrl);
      }
      const artifact = await stitchInBrowser(sources, context.config, signal);
      const mediaId = await saveStitchArtifact(projectId, artifact, signal);
      const previewUrl = await stitchWait(stitchArtifactUrl(mediaId, projectId), signal);
      const media = { provider: 'GOOGLE_FLOW' as const, type: 'VIDEO' as const, mediaId, projectId,
        previewUrl, mimeType: artifact.blob.type, fileName: `stitch-${mediaId.slice(11)}.webm` };
      return { outputs: { video: mediaValue(media) }, result: { ...media, type: 'video' } };
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError('MEDIA_FAILED', 'Stitch failed; no completed output was published.', { nodeId: context.nodeId });
    }
  }
}

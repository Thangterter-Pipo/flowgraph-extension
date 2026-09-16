import { describe, it, expect, vi, afterEach } from 'vitest';
import { VideoConcatExecutor } from '../../src/runtime/executors/VideoConcatExecutor';
import { mediaValue } from '../../src/runtime/RuntimeValue';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';
import type { RuntimeMediaRef } from '../../src/runtime/RuntimeValue';
import * as engine from '../../src/runtime/stitch/BrowserStitchEngine';
import * as store from '../../src/runtime/stitch/StitchArtifactStore';

describe('VideoConcatExecutor', () => {
  afterEach(() => vi.restoreAllMocks());
  const executor = new VideoConcatExecutor();

  const createMockContext = (inputs: Record<string, any>, config: Record<string, any> = {}): NodeExecutionContext => ({
    nodeId: 'concat-node-1',
    runId: 'run-1',
    inputs,
    config,
    context: {} as any,
  });

  const createMockVideo = (id: string): RuntimeMediaRef => ({
    type: 'VIDEO',
    mediaId: id,
    projectId: 'test-project',
    provider: 'GOOGLE_FLOW',
  });

  it('validates that inputs are present', () => {
    const invalid = executor.validate(createMockContext({}));
    expect(invalid.valid).toBe(false);

    const valid = executor.validate(createMockContext({
      videos: [mediaValue(createMockVideo('v1'))],
    }));
    expect(valid.valid).toBe(true);
  });

  it('throws INVALID_INPUT when no video inputs are provided in execute', async () => {
    const ctx = createMockContext({});
    await expect(executor.execute(ctx)).rejects.toThrow('Stitch / Timeline requires at least 1 video input');
  });

  it('passes through directly when exactly 1 video is provided', async () => {
    const video = createMockVideo('video-1');
    const ctx = createMockContext({
      videos: [mediaValue(video)],
    });

    const result = await executor.execute(ctx);
    expect(result.outputs.video).toBeDefined();
    expect((result.outputs.video as any).value.mediaId).toBe('video-1');
  });

  it('fails closed without a browser instead of synthesizing a concatenated media ref', async () => {
    const v1 = createMockVideo('shot-1');
    const v2 = createMockVideo('shot-2');
    const v3 = createMockVideo('shot-3');

    const ctx = createMockContext({
      videos: [
        mediaValue(v1),
        mediaValue(v2),
        mediaValue(v3),
      ],
    }, {
      transition: 'crossfade',
      transitionDuration: '0.5s',
    });

    await expect(executor.execute(ctx)).rejects.toMatchObject({ code: 'MEDIA_FAILED' });
  });

  it('accepts videos passed via both single and array formats', async () => {
    const v1 = createMockVideo('shot-1');
    const v2 = createMockVideo('shot-2');

    const ctx = createMockContext({
      video: mediaValue(v1),
      videos: mediaValue(v2),
    });

    await expect(executor.execute(ctx)).rejects.toMatchObject({ code: 'MEDIA_FAILED' });
  });

  it('resolves all exact source identities in order and commits before returning local output', async () => {
    const waitForMedia = vi.fn(async ({ mediaId, projectId }) => ({ status: 'SUCCESSFUL', media: {
      mediaId, projectId, type: 'VIDEO', previewUrl: `https://example.test/${mediaId}.webm`,
    } }));
    const artifact = { blob: new Blob(['test fixture'], { type: 'video/webm' }), duration: 12, width: 320, height: 180 };
    const stitch = vi.spyOn(engine, 'stitchInBrowser').mockResolvedValue(artifact);
    const save = vi.spyOn(store, 'saveStitchArtifact').mockResolvedValue('stitch-idb:test-key');
    vi.spyOn(store, 'stitchArtifactUrl').mockResolvedValue('blob:test');
    const executor = new VideoConcatExecutor({ adapter: { waitForMedia } as any });
    const ctx = createMockContext({ videos: ['a', 'b', 'c', 'd'].map((id) => mediaValue(createMockVideo(id))) });
    ctx.context = { activeProject: { projectId: 'test-project' } } as any;
    const output = await executor.execute(ctx);
    expect(waitForMedia.mock.calls.map(([arg]) => arg.mediaId)).toEqual(['a', 'b', 'c', 'd']);
    expect(stitch.mock.calls[0][0]).toEqual(['a', 'b', 'c', 'd'].map((id) => `https://example.test/${id}.webm`));
    expect(save).toHaveBeenCalledWith('test-project', artifact, undefined);
    expect((output.outputs.video.value as RuntimeMediaRef).mediaId).toBe('stitch-idb:test-key');
    save.mockRejectedValueOnce(new Error('quota'));
    await expect(executor.execute(ctx)).rejects.toMatchObject({ code: 'MEDIA_FAILED' });
  });

  it('rejects wrong project, non-video and cancellation instead of dropping inputs', async () => {
    const ctx = createMockContext({ videos: [mediaValue(createMockVideo('a')), mediaValue({ ...createMockVideo('b'), type: 'IMAGE' })] });
    await expect(executor.execute(ctx)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const abort = new AbortController();
    abort.abort();
    await expect(executor.execute(ctx, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    ctx.inputs.videos = [mediaValue(createMockVideo('a')), mediaValue({ ...createMockVideo('b'), projectId: 'other' })];
    ctx.context = { activeProject: { projectId: 'test-project' } } as any;
    await expect(executor.execute(ctx)).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
  });
});

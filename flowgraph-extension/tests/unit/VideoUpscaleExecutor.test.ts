import { describe, it, expect, vi } from 'vitest';
import { VideoUpscaleExecutor } from '../../src/runtime/executors/VideoUpscaleExecutor';
import { RuntimeError } from '../../src/runtime/RuntimeError';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';

describe('VideoUpscaleExecutor', () => {
  const mockAdapter = {
    generate: vi.fn(),
    waitForMedia: vi.fn(),
  } as unknown as GoogleFlowAdapter;

  const validMediaRef = {
    mediaId: 'vid-12345',
    projectId: 'proj-1',
    type: 'VIDEO',
  };

  const createValidContext = (overrides?: Partial<NodeExecutionContext>): NodeExecutionContext => ({
    runId: 'run-1',
    nodeId: 'node-upscale-vid',
    inputs: {
      video: {
        type: 'video',
        value: validMediaRef,
      },
    },
    config: {
      targetResolution: '1080p',
    },
    context: {
      activeProject: { projectId: 'proj-1' },
      throwIfAborted: vi.fn(),
    } as any,
    ...overrides,
  });

  it('validates correctly with valid video input and 1080p resolution', () => {
    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext();
    const result = executor.validate(ctx);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates correctly with 4K resolution', () => {
    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({ config: { targetResolution: '4K' } });
    const result = executor.validate(ctx);
    expect(result.valid).toBe(true);
  });

  it('fails validation when video input is missing', () => {
    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({ inputs: {} });
    const result = executor.validate(ctx);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Video Upscale requires a video connected to the Video input.');
  });

  it('fails validation when targetResolution is invalid', () => {
    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({ config: { targetResolution: '8K' } });
    const result = executor.validate(ctx);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid targetResolution "8K"');
  });

  it('fails validation when active project is missing', () => {
    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({
      context: { activeProject: { projectId: '' }, throwIfAborted: vi.fn() } as any,
    });
    const result = executor.validate(ctx);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Video Upscale requires an active project.');
  });

  it('enforces project isolation on execute', async () => {
    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({
      context: { activeProject: { projectId: 'proj-OTHER' }, throwIfAborted: vi.fn() } as any,
    });
    await expect(executor.execute(ctx)).rejects.toThrow(RuntimeError);
  });

  it('rejects non-VIDEO media input type', async () => {
    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({
      inputs: {
        video: {
          type: 'video',
          value: { mediaId: 'img-123', projectId: 'proj-1', type: 'IMAGE' },
        },
      },
    });
    await expect(executor.execute(ctx)).rejects.toThrow(RuntimeError);
  });

  it('executes successfully and returns upscaled VIDEO MediaRef via polling', async () => {
    (mockAdapter.generate as any).mockResolvedValueOnce({
      mediaId: 'vid-upscaled-888',
      type: 'VIDEO',
    });

    (mockAdapter.waitForMedia as any).mockResolvedValueOnce({
      status: 'SUCCESSFUL',
      media: {
        mediaId: 'vid-upscaled-888',
        type: 'VIDEO',
        previewUrl: 'https://example.com/upscaled.mp4',
      },
    });

    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext();
    const output = await executor.execute(ctx);

    expect((mockAdapter.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        kind: 'upscale',
        projectId: 'proj-1',
        modelKey: 'veo_3_1_upsampler_1080p',
        videoInput: { mediaId: 'vid-12345' },
      }),
    );

    expect(output.outputs.video).toBeDefined();
    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).mediaId).toBe('vid-upscaled-888');
    expect(output.result?.mediaId).toBe('vid-upscaled-888');
    expect(output.result?.previewUrl).toBe('https://example.com/upscaled.mp4');
  });
});

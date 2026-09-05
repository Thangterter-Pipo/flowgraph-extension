import { describe, it, expect, vi } from 'vitest';
import { ImageUpscaleExecutor } from '../../src/runtime/executors/ImageUpscaleExecutor';
import { VideoUpscaleExecutor } from '../../src/runtime/executors/VideoUpscaleExecutor';
import { RuntimeError } from '../../src/runtime/RuntimeError';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';

describe('Upscale Boundary Hardening & Media Type Regression (Task 4A.3)', () => {
  const mockAdapter = {
    generate: vi.fn(),
    waitForMedia: vi.fn(),
  } as unknown as GoogleFlowAdapter;

  const validImageRef = {
    mediaId: 'img-12345',
    projectId: 'proj-active',
    type: 'IMAGE',
  };

  const validVideoRef = {
    mediaId: 'vid-67890',
    projectId: 'proj-active',
    type: 'VIDEO',
  };

  it('ImageUpscaleExecutor enforces project isolation and fails before provider call', async () => {
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx: NodeExecutionContext = {
      runId: 'run-1',
      nodeId: 'node-img-upscale',
      inputs: {
        image: {
          type: 'image',
          value: { ...validImageRef, projectId: 'proj-OTHER' },
        },
      },
      config: { targetResolution: '2K' },
      context: {
        activeProject: { projectId: 'proj-active' },
        throwIfAborted: vi.fn(),
      } as any,
    };

    await expect(executor.execute(ctx)).rejects.toThrow(RuntimeError);
    await expect(executor.execute(ctx)).rejects.toMatchObject({
      code: 'PROJECT_ISOLATION',
    });
    expect(mockAdapter.generate).not.toHaveBeenCalled();
  });

  it('VideoUpscaleExecutor enforces project isolation and fails before provider call', async () => {
    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx: NodeExecutionContext = {
      runId: 'run-2',
      nodeId: 'node-vid-upscale',
      inputs: {
        video: {
          type: 'video',
          value: { ...validVideoRef, projectId: 'proj-OTHER' },
        },
      },
      config: { targetResolution: '1080p' },
      context: {
        activeProject: { projectId: 'proj-active' },
        throwIfAborted: vi.fn(),
      } as any,
    };

    await expect(executor.execute(ctx)).rejects.toThrow(RuntimeError);
    await expect(executor.execute(ctx)).rejects.toMatchObject({
      code: 'PROJECT_ISOLATION',
    });
    expect(mockAdapter.generate).not.toHaveBeenCalled();
  });

  it('ImageUpscaleExecutor strictly produces an IMAGE MediaRef from provider response', async () => {
    (mockAdapter.generate as any).mockResolvedValueOnce({
      mediaId: 'img-upscaled-2k',
      type: 'IMAGE',
      projectId: 'proj-active',
      previewUrl: 'https://flow.google.com/asb/token-2k-img',
    });

    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx: NodeExecutionContext = {
      runId: 'run-3',
      nodeId: 'node-img-upscale-success',
      inputs: {
        image: {
          type: 'image',
          value: validImageRef,
        },
      },
      config: { targetResolution: '2K' },
      context: {
        activeProject: { projectId: 'proj-active' },
        throwIfAborted: vi.fn(),
      } as any,
    };

    const output = await executor.execute(ctx);
    expect(output.outputs.image).toBeDefined();
    expect(output.outputs.image.type).toBe('image');
    expect((output.outputs.image.value as any).type).toBe('IMAGE');
    expect((output.outputs.image.value as any).mediaId).toBe('img-upscaled-2k');
    expect(output.result?.type).toBe('image');
    expect(output.result?.mediaId).toBe('img-upscaled-2k');
  });

  it('VideoUpscaleExecutor strictly produces a VIDEO MediaRef from async provider polling response', async () => {
    (mockAdapter.generate as any).mockResolvedValueOnce({
      mediaId: 'vid-upscaled-1080p',
      type: 'VIDEO',
      projectId: 'proj-active',
    });

    (mockAdapter.waitForMedia as any).mockResolvedValueOnce({
      status: 'SUCCESSFUL',
      media: {
        mediaId: 'vid-upscaled-1080p',
        type: 'VIDEO',
        projectId: 'proj-active',
        previewUrl: 'https://flow.google.com/asb/token-1080p-vid',
      },
    });

    const executor = new VideoUpscaleExecutor({ adapter: mockAdapter });
    const ctx: NodeExecutionContext = {
      runId: 'run-4',
      nodeId: 'node-vid-upscale-success',
      inputs: {
        video: {
          type: 'video',
          value: validVideoRef,
        },
      },
      config: { targetResolution: '1080p' },
      context: {
        activeProject: { projectId: 'proj-active' },
        throwIfAborted: vi.fn(),
      } as any,
    };

    const output = await executor.execute(ctx);
    expect(output.outputs.video).toBeDefined();
    expect(output.outputs.video.type).toBe('video');
    expect((output.outputs.video.value as any).type).toBe('VIDEO');
    expect((output.outputs.video.value as any).mediaId).toBe('vid-upscaled-1080p');
    expect(output.result?.type).toBe('video');
    expect(output.result?.mediaId).toBe('vid-upscaled-1080p');
    expect(output.result?.previewUrl).toBe('https://flow.google.com/asb/token-1080p-vid');
  });
});

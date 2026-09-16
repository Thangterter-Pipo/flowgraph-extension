import { describe, it, expect, vi } from 'vitest';
import { ImageUpscaleExecutor } from '../../src/runtime/executors/ImageUpscaleExecutor';
import { RuntimeError } from '../../src/runtime/RuntimeError';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';

describe('ImageUpscaleExecutor', () => {
  const mockAdapter = {
    generate: vi.fn(),
  } as unknown as GoogleFlowAdapter;

  const validMediaRef = {
    mediaId: 'img-12345',
    projectId: 'proj-1',
    type: 'IMAGE',
  };

  const createValidContext = (overrides?: Partial<NodeExecutionContext>): NodeExecutionContext => ({
    runId: 'run-1',
    nodeId: 'node-upscale-img',
    inputs: {
      image: {
        type: 'image',
        value: validMediaRef,
      },
    },
    config: {
      targetResolution: '2K',
    },
    context: {
      activeProject: { projectId: 'proj-1' },
      throwIfAborted: vi.fn(),
      trackMediaJob: vi.fn(),
    } as any,
    ...overrides,
  });

  it('validates correctly with valid image input and 2K resolution', () => {
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext();
    const result = executor.validate(ctx);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates correctly with 4K resolution', () => {
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({ config: { targetResolution: '4K' } });
    const result = executor.validate(ctx);
    expect(result.valid).toBe(true);
  });

  it('fails validation when image input is missing', () => {
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({ inputs: {} });
    const result = executor.validate(ctx);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Image Upscale requires an image connected to the Image input.');
  });

  it('fails validation when targetResolution is invalid', () => {
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({ config: { targetResolution: '8K' } });
    const result = executor.validate(ctx);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid targetResolution "8K"');
  });

  it('fails validation when active project is missing', () => {
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({
      context: { activeProject: { projectId: '' }, throwIfAborted: vi.fn() } as any,
    });
    const result = executor.validate(ctx);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Image Upscale requires an active project.');
  });

  it('enforces project isolation on execute', async () => {
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({
      context: { activeProject: { projectId: 'proj-OTHER' }, throwIfAborted: vi.fn() } as any,
    });
    await expect(executor.execute(ctx)).rejects.toThrow(RuntimeError);
  });

  it('rejects non-IMAGE media input type', async () => {
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext({
      inputs: {
        image: {
          type: 'image',
          value: { mediaId: 'vid-123', projectId: 'proj-1', type: 'VIDEO' },
        },
      },
    });
    await expect(executor.execute(ctx)).rejects.toThrow(RuntimeError);
  });

  it('executes successfully and returns upscaled IMAGE MediaRef', async () => {
    (mockAdapter.generate as any).mockResolvedValueOnce({
      mediaId: 'img-upscaled-999',
      type: 'IMAGE',
      previewUrl: 'https://example.com/upscaled.jpg',
    });

    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const ctx = createValidContext();
    const output = await executor.execute(ctx);

    expect((mockAdapter.generate as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        kind: 'imageUpscale',
        projectId: 'proj-1',
        modelKey: 'GEM_PIX_2_UPSAMPLE_2K',
        targetResolution: 'UPSAMPLE_IMAGE_RESOLUTION_2K',
      }),
    );

    expect(output.outputs.image).toBeDefined();
    expect(output.outputs.image.type).toBe('image');
    expect((output.outputs.image.value as any).mediaId).toBe('img-upscaled-999');
    expect(output.result?.mediaId).toBe('img-upscaled-999');
  });

  it('aborts a pending generate without returning success', async () => {
    const abort = new AbortController();
    (mockAdapter.generate as any).mockImplementation((_payload: unknown, options?: { onMediaId?: (id: string) => void }) => {
      options?.onMediaId?.('upscale-media-real');
      return new Promise(() => undefined);
    });
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const context = {
      activeProject: { projectId: 'proj-1' },
      abortSignal: abort.signal,
      aborted: false,
      throwIfAborted() {
        if (abort.signal.aborted) {
          const error = new Error('Run aborted') as Error & { code: string };
          error.code = 'CANCELLED';
          throw error;
        }
      },
      trackMediaJob: vi.fn(),
    };
    const ctx = createValidContext({ context: context as any });
    const started = Date.now();
    const pending = executor.execute(ctx, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 30));
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(Date.now() - started).toBeLessThan(800);
    expect(context.trackMediaJob).toHaveBeenCalledTimes(1);
    expect(context.trackMediaJob).toHaveBeenCalledWith('upscale-media-real');
  });

  it('does not track or fabricate a mediaId when the provider never reports one', async () => {
    const abort = new AbortController();
    (mockAdapter.generate as any).mockImplementation(() => new Promise(() => undefined));
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const context = {
      activeProject: { projectId: 'proj-1' },
      abortSignal: abort.signal,
      aborted: false,
      throwIfAborted() {
        if (abort.signal.aborted) {
          const error = new Error('Run aborted') as Error & { code: string };
          error.code = 'CANCELLED';
          throw error;
        }
      },
      trackMediaJob: vi.fn(),
    };
    const ctx = createValidContext({ context: context as any });
    const pending = executor.execute(ctx, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 30));
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(context.trackMediaJob).not.toHaveBeenCalled();
  });

  it('never returns success if generate resolves after abort', async () => {
    const abort = new AbortController();
    let finish: ((value: unknown) => void) | undefined;
    (mockAdapter.generate as any).mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const executor = new ImageUpscaleExecutor({ adapter: mockAdapter });
    const context = {
      activeProject: { projectId: 'proj-1' },
      abortSignal: abort.signal,
      aborted: false,
      throwIfAborted() {
        if (abort.signal.aborted) {
          const error = new Error('Run aborted') as Error & { code: string };
          error.code = 'CANCELLED';
          throw error;
        }
      },
      trackMediaJob: vi.fn(),
    };
    const ctx = createValidContext({ context: context as any });
    const pending = executor.execute(ctx, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 30));
    abort.abort();
    finish?.({
      mediaId: 'upscale-late-success',
      type: 'IMAGE',
      previewUrl: 'https://example.com/late.jpg',
    });
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(context.trackMediaJob).not.toHaveBeenCalled();
  });
});

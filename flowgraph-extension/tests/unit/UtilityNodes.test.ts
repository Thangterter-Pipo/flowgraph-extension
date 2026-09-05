import { describe, it, expect, vi } from 'vitest';
import { MediaInputExecutor } from '../../src/runtime/executors/MediaInputExecutor';
import { ImageInputExecutor } from '../../src/runtime/executors/ImageInputExecutor';
import { VideoInputExecutor } from '../../src/runtime/executors/VideoInputExecutor';
import { PreviewExecutor } from '../../src/runtime/executors/PreviewExecutor';
import { RuntimeError } from '../../src/runtime/RuntimeError';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';

describe('Task 5A — Utility Nodes (MediaInput, ImageInput, VideoInput, Preview)', () => {
  const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';

  describe('MediaInputExecutor', () => {
    it('validates correctly with configured mediaId', () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: 'med-123', mediaType: 'IMAGE' },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(true);
    });

    it('fails validation when mediaId is empty', () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: '' },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('requires a configured mediaId');
    });

    it('enforces project isolation on execute', async () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: 'med-123', projectId: 'other-project' },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      await expect(executor.execute(ctx)).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
    });

    it('executes and outputs valid typed MediaRef', async () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: 'med-123', mediaType: 'IMAGE', previewUrl: 'https://flow.google.com/asb/test' },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(out.outputs.media).toBeDefined();
      expect(out.outputs.image).toBeDefined();
      expect((out.outputs.media.value as any).mediaId).toBe('med-123');
      expect((out.outputs.media.value as any).type).toBe('IMAGE');
    });
  });

  describe('ImageInputExecutor & VideoInputExecutor', () => {
    it('ImageInputExecutor outputs strictly IMAGE MediaRef', async () => {
      const executor = new ImageInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r2',
        nodeId: 'n2',
        inputs: {},
        config: { mediaId: 'img-999' },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(out.outputs.image).toBeDefined();
      expect((out.outputs.image.value as any).type).toBe('IMAGE');
      expect((out.outputs.image.value as any).mediaId).toBe('img-999');
    });

    it('VideoInputExecutor outputs strictly VIDEO MediaRef', async () => {
      const executor = new VideoInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r3',
        nodeId: 'n3',
        inputs: {},
        config: { mediaId: 'vid-888' },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(out.outputs.video).toBeDefined();
      expect((out.outputs.video.value as any).type).toBe('VIDEO');
      expect((out.outputs.video.value as any).mediaId).toBe('vid-888');
    });
  });

  describe('PreviewExecutor', () => {
    it('validates correctly when media input is connected', () => {
      const executor = new PreviewExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r4',
        nodeId: 'n4',
        inputs: {
          media: {
            type: 'image',
            value: { mediaId: 'img-123', projectId: PROJECT, type: 'IMAGE' },
          },
        },
        config: {},
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(true);
    });

    it('passes through upstream MediaRef without modifying mediaId or type', async () => {
      const executor = new PreviewExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r5',
        nodeId: 'n5',
        inputs: {
          media: {
            type: 'video',
            value: { mediaId: 'vid-pass', projectId: PROJECT, type: 'VIDEO', previewUrl: 'https://flow.google.com/asb/vid' },
          },
        },
        config: {},
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(out.outputs.video).toBeDefined();
      expect((out.outputs.video.value as any).mediaId).toBe('vid-pass');
      expect((out.outputs.video.value as any).type).toBe('VIDEO');
      expect(out.result?.previewUrl).toBe('https://flow.google.com/asb/vid');
    });

    it('enforces project isolation on execute', async () => {
      const executor = new PreviewExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r6',
        nodeId: 'n6',
        inputs: {
          media: {
            type: 'image',
            value: { mediaId: 'img-123', projectId: 'other-proj', type: 'IMAGE' },
          },
        },
        config: {},
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      await expect(executor.execute(ctx)).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
    });
  });
});

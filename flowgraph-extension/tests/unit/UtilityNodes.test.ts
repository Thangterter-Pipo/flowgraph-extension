import { describe, it, expect, vi } from 'vitest';
import { MediaInputExecutor } from '../../src/runtime/executors/MediaInputExecutor';
import { ImageInputExecutor } from '../../src/runtime/executors/ImageInputExecutor';
import { VideoInputExecutor } from '../../src/runtime/executors/VideoInputExecutor';
import { PreviewExecutor } from '../../src/runtime/executors/PreviewExecutor';
import { RuntimeError } from '../../src/runtime/RuntimeError';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';

describe('Task 5A.1 — Hardened Utility Nodes (MediaInput, ImageInput, VideoInput, Preview)', () => {
  const PROJECT = '729eaa19-1c85-4cfc-89c3-5f86de2dffc5';

  describe('MediaInputExecutor', () => {
    it('validates correctly with configured mediaId, mediaType, and explicit projectId provenance', () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: 'med-123', mediaType: 'IMAGE', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('fails validation when mediaId is empty', () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: '', mediaType: 'IMAGE', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('requires a configured mediaId');
    });

    it('fails validation when explicit projectId provenance is missing', () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: 'med-123', mediaType: 'IMAGE' },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('explicit projectId provenance');
    });

    it('fails validation when mediaType is invalid', () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: 'med-123', mediaType: 'AUDIO', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Must strictly be "IMAGE" or "VIDEO"');
    });

    it('enforces project isolation on execute', async () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: 'med-123', mediaType: 'IMAGE', projectId: 'other-project' },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      await expect(executor.execute(ctx)).rejects.toMatchObject({ code: 'PROJECT_ISOLATION' });
    });

    it('executes and outputs strictly via typed media port without persisting signed url', async () => {
      const executor = new MediaInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r1',
        nodeId: 'n1',
        inputs: {},
        config: { mediaId: 'med-123', mediaType: 'IMAGE', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(out.outputs.media).toBeDefined();
      expect(out.outputs.image).toBeUndefined(); // strictly static typed port
      expect((out.outputs.media.value as any).mediaId).toBe('med-123');
      expect((out.outputs.media.value as any).type).toBe('IMAGE');
      expect((out.outputs.media.value as any).previewUrl).toBeUndefined();
    });
  });

  describe('ImageInputExecutor & VideoInputExecutor', () => {
    it('ImageInputExecutor requires explicit projectId and outputs strictly IMAGE MediaRef', async () => {
      const executor = new ImageInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r2',
        nodeId: 'n2',
        inputs: {},
        config: { mediaId: 'img-999', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(out.outputs.image).toBeDefined();
      expect(out.outputs.media).toBeUndefined(); // strictly static typed port
      expect((out.outputs.image.value as any).type).toBe('IMAGE');
      expect((out.outputs.image.value as any).mediaId).toBe('img-999');
      expect((out.outputs.image.value as any).previewUrl).toBeUndefined();
    });

    it('VideoInputExecutor requires explicit projectId and outputs strictly VIDEO MediaRef', async () => {
      const executor = new VideoInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r3',
        nodeId: 'n3',
        inputs: {},
        config: { mediaId: 'vid-888', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(out.outputs.video).toBeDefined();
      expect(out.outputs.media).toBeUndefined(); // strictly static typed port
      expect((out.outputs.video.value as any).type).toBe('VIDEO');
      expect((out.outputs.video.value as any).mediaId).toBe('vid-888');
      expect((out.outputs.video.value as any).previewUrl).toBeUndefined();
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

    it('passes through upstream MediaRef strictly via typed media port', async () => {
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
      expect(out.outputs.media).toBeDefined();
      expect(out.outputs.video).toBeUndefined(); // strictly static typed port
      expect((out.outputs.media.value as any).mediaId).toBe('vid-pass');
      expect((out.outputs.media.value as any).type).toBe('VIDEO');
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

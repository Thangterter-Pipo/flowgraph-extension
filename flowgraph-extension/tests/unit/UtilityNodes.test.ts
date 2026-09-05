import { describe, it, expect, vi } from 'vitest';
import { MediaInputExecutor } from '../../src/runtime/executors/MediaInputExecutor';
import { ImageInputExecutor } from '../../src/runtime/executors/ImageInputExecutor';
import { VideoInputExecutor } from '../../src/runtime/executors/VideoInputExecutor';
import { PreviewExecutor } from '../../src/runtime/executors/PreviewExecutor';
import { RuntimeError } from '../../src/runtime/RuntimeError';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';

describe('Task 5A.3 — Hardened Utility Nodes Config Materialization & Mandatory MediaType', () => {
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

    it('fails validation when mediaType is missing or invalid', () => {
      const executor = new MediaInputExecutor();
      const ctxMissing: NodeExecutionContext = {
        runId: 'r1-m',
        nodeId: 'n1-m',
        inputs: {},
        config: { mediaId: 'med-123', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      expect(executor.validate(ctxMissing).valid).toBe(false);

      const ctxInvalid: NodeExecutionContext = {
        runId: 'r1-i',
        nodeId: 'n1-i',
        inputs: {},
        config: { mediaId: 'med-123', mediaType: 'AUDIO', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      expect(executor.validate(ctxInvalid).valid).toBe(false);
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
      expect((out.outputs.media.value as any).mediaId).toBe('med-123');
      expect((out.outputs.media.value as any).type).toBe('IMAGE');
      expect((out.outputs.media.value as any).previewUrl).toBeUndefined();
    });
  });

  describe('ImageInputExecutor & VideoInputExecutor Type Boundary (Task 5A.3)', () => {
    it('ImageInputExecutor fails validation if mediaType is missing', () => {
      const executor = new ImageInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r2-missing',
        nodeId: 'n2-missing',
        inputs: {},
        config: { mediaId: 'img-999', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('requires an explicit mediaType: "IMAGE"');
    });

    it('ImageInputExecutor throws INVALID_INPUT on execute if mediaType is missing', async () => {
      const executor = new ImageInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r2-exec-missing',
        nodeId: 'n2-exec-missing',
        inputs: {},
        config: { mediaId: 'img-999', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      await expect(executor.execute(ctx)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('VideoInputExecutor fails validation if mediaType is missing', () => {
      const executor = new VideoInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r3-missing',
        nodeId: 'n3-missing',
        inputs: {},
        config: { mediaId: 'vid-888', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('requires an explicit mediaType: "VIDEO"');
    });

    it('VideoInputExecutor throws INVALID_INPUT on execute if mediaType is missing', async () => {
      const executor = new VideoInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r3-exec-missing',
        nodeId: 'n3-exec-missing',
        inputs: {},
        config: { mediaId: 'vid-888', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      await expect(executor.execute(ctx)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('ImageInputExecutor fails validation if mediaType is VIDEO', () => {
      const executor = new ImageInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r2-v',
        nodeId: 'n2-v',
        inputs: {},
        config: { mediaId: 'img-999', mediaType: 'VIDEO', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Must strictly be "IMAGE"');
    });

    it('ImageInputExecutor throws INVALID_INPUT on execute if mediaType is VIDEO', async () => {
      const executor = new ImageInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r2-e',
        nodeId: 'n2-e',
        inputs: {},
        config: { mediaId: 'img-999', mediaType: 'VIDEO', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      await expect(executor.execute(ctx)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('VideoInputExecutor fails validation if mediaType is IMAGE', () => {
      const executor = new VideoInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r3-v',
        nodeId: 'n3-v',
        inputs: {},
        config: { mediaId: 'vid-888', mediaType: 'IMAGE', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const res = executor.validate(ctx);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Must strictly be "VIDEO"');
    });

    it('VideoInputExecutor throws INVALID_INPUT on execute if mediaType is IMAGE', async () => {
      const executor = new VideoInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r3-e',
        nodeId: 'n3-e',
        inputs: {},
        config: { mediaId: 'vid-888', mediaType: 'IMAGE', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      await expect(executor.execute(ctx)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    });

    it('ImageInputExecutor outputs strictly IMAGE MediaRef when valid', async () => {
      const executor = new ImageInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r2',
        nodeId: 'n2',
        inputs: {},
        config: { mediaId: 'img-999', mediaType: 'IMAGE', projectId: PROJECT },
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(out.outputs.image).toBeDefined();
      expect((out.outputs.image.value as any).type).toBe('IMAGE');
      expect((out.outputs.image.value as any).mediaId).toBe('img-999');
    });

    it('VideoInputExecutor outputs strictly VIDEO MediaRef when valid', async () => {
      const executor = new VideoInputExecutor();
      const ctx: NodeExecutionContext = {
        runId: 'r3',
        nodeId: 'n3',
        inputs: {},
        config: { mediaId: 'vid-888', mediaType: 'VIDEO', projectId: PROJECT },
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

    it('passes through upstream MediaRef strictly via typed media port and resolves transient previewUrl', async () => {
      const mockAdapter = {
        resolvePreviewUrl: vi.fn().mockResolvedValueOnce('https://flow.google.com/asb/dynamic-resolved-token'),
      } as any;
      const executor = new PreviewExecutor({ adapter: mockAdapter });
      const ctx: NodeExecutionContext = {
        runId: 'r5',
        nodeId: 'n5',
        inputs: {
          media: {
            type: 'video',
            value: { mediaId: 'vid-pass', projectId: PROJECT, type: 'VIDEO' }, // no previewUrl
          },
        },
        config: {},
        context: { activeProject: { projectId: PROJECT }, throwIfAborted: vi.fn() } as any,
      };
      const out = await executor.execute(ctx);
      expect(mockAdapter.resolvePreviewUrl).toHaveBeenCalledWith('vid-pass', PROJECT);
      expect(out.outputs.media).toBeDefined();
      expect((out.outputs.media.value as any).mediaId).toBe('vid-pass');
      expect((out.outputs.media.value as any).type).toBe('VIDEO');
      expect(out.result?.previewUrl).toBe('https://flow.google.com/asb/dynamic-resolved-token');
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

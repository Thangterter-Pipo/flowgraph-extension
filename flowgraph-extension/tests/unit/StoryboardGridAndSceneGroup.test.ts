import { describe, it, expect, vi } from 'vitest';
import { StoryboardSplitterExecutor } from '../../src/runtime/executors/StoryboardSplitterExecutor';
import { SceneGroupExecutor } from '../../src/runtime/executors/SceneGroupExecutor';
import { BUILTIN_TEMPLATES } from '../../src/ui/studio/workflowTemplates';
import { portsForKind } from '../../src/ui/studio/ports';
import { mediaValue } from '../../src/runtime/RuntimeValue';
import type { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';

describe('Storyboard 9-Grid & Scene Group Container (LibTV Architecture)', () => {
  const baseContext = (overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext => ({
    runId: 'run-1',
    nodeId: 'node-test',
    inputs: {},
    config: {},
    context: {
      runId: 'run-1',
      workflowId: 'wf-1',
      activeProject: { projectId: 'proj-123', projectName: 'Test Project', selectedAt: '2026-10-03' },
      account: { email: 'test@example.com' } as any,
      flow: { ready: true } as any,
      throwIfAborted: vi.fn(),
      failures: new Map(),
      fail: vi.fn(),
      failureFor: vi.fn(),
      aborted: false,
    } as any,
    ...overrides,
  } as NodeExecutionContext);

  describe('StoryboardSplitterExecutor', () => {
    it('fails validation when image input is missing', () => {
      const executor = new StoryboardSplitterExecutor();
      const res = executor.validate(baseContext({ inputs: {}, config: {} }));
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('requires an input grid image');
    });

    it('fails validation when input is not an IMAGE type', () => {
      const executor = new StoryboardSplitterExecutor();
      const res = executor.validate(baseContext({
        inputs: {
          image: { type: 'video', value: { type: 'VIDEO', mediaId: 'v-1' } } as any,
        },
      }));
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('only accepts IMAGE inputs');
    });

    it('splits 3x3 grid into 9 individual shot image outputs', async () => {
      const executor = new StoryboardSplitterExecutor();
      const inputMedia = {
        provider: 'GOOGLE_FLOW' as const,
        type: 'IMAGE' as const,
        mediaId: 'grid-9-image',
        projectId: 'proj-123',
        previewUrl: 'https://example.com/grid.jpg',
      };

      const out = await executor.execute(baseContext({
        inputs: {
          image: mediaValue(inputMedia),
        },
        config: {
          gridFormat: '3x3',
          cleanBorders: 'true',
        },
      }));

      expect(Object.keys(out.outputs)).toHaveLength(9);
      for (let i = 1; i <= 9; i++) {
        const shotKey = `shot${i}`;
        expect(out.outputs[shotKey]).toBeDefined();
        expect(out.outputs[shotKey].type).toBe('image');
        const val = out.outputs[shotKey].value as any;
        expect(val.mediaId).toBe(`grid-9-image-shot-${i}`);
        expect(val.type).toBe('IMAGE');
      }
      expect(out.result?.type).toBe('image');
      expect(out.result?.fileName).toBe('storyboard-split-3x3.jpg');
    });

    it('splits 2x2 grid into 4 individual shot image outputs', async () => {
      const executor = new StoryboardSplitterExecutor();
      const inputMedia = {
        provider: 'GOOGLE_FLOW' as const,
        type: 'IMAGE' as const,
        mediaId: 'grid-4-image',
        projectId: 'proj-123',
        previewUrl: 'https://example.com/grid4.jpg',
      };

      const out = await executor.execute(baseContext({
        inputs: {
          image: mediaValue(inputMedia),
        },
        config: {
          gridFormat: '2x2',
          cleanBorders: 'false',
        },
      }));

      expect(Object.keys(out.outputs)).toHaveLength(4);
      for (let i = 1; i <= 4; i++) {
        const shotKey = `shot${i}`;
        expect(out.outputs[shotKey]).toBeDefined();
        expect(out.outputs[shotKey].type).toBe('image');
        const val = out.outputs[shotKey].value as any;
        expect(val.mediaId).toBe(`grid-4-image-shot-${i}`);
      }
    });
  });

  describe('SceneGroupExecutor', () => {
    it('passes validation without errors', () => {
      const executor = new SceneGroupExecutor();
      const res = executor.validate(baseContext());
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('passes through media input to output and preserves scene information', async () => {
      const executor = new SceneGroupExecutor();
      const media = mediaValue({
        provider: 'GOOGLE_FLOW' as const,
        type: 'VIDEO' as const,
        mediaId: 'scene-vid-1',
        projectId: 'proj-123',
      });

      const out = await executor.execute(baseContext({
        inputs: {
          mediaIn: media,
        },
        config: {
          sceneName: 'Scene 1: Bưu điện 17',
          description: 'Cảnh mưa đêm vàng ấm',
        },
      }));

      expect(out.outputs.mediaOut).toBeDefined();
      expect(out.outputs.mediaOut.type).toBe('video');
      expect(out.result?.fileName).toBe('Scene 1: Bưu điện 17.group');
    });
  });

  describe('Builtin LibTV Storyboard Template', () => {
    it('contains the new LibTV Storyboard 9-Grid pipeline template', () => {
      const tpl = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl-libtv-storyboard-grid');
      expect(tpl).toBeDefined();
      expect(tpl?.title).toContain('Storyboard 9-Grid');
      expect(tpl?.category).toBe('cinematic');
    });

    it('wires the storyboardSplit and sceneGroup nodes with 100% valid port handles', () => {
      const tpl = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl-libtv-storyboard-grid')!;
      for (const edge of tpl.edges) {
        const sourceNode = tpl.nodes.find((n) => n.id === edge.source)!;
        const targetNode = tpl.nodes.find((n) => n.id === edge.target)!;
        expect(sourceNode).toBeDefined();
        expect(targetNode).toBeDefined();

        const sourcePorts = portsForKind(sourceNode.data.kind);
        const targetPorts = portsForKind(targetNode.data.kind);

        const hasSource = sourcePorts.outputs.some((p) => p.id === edge.sourceHandle);
        const hasTarget = targetPorts.inputs.some((p) => p.id === edge.targetHandle);

        expect(hasSource, `Missing output handle ${edge.sourceHandle} on ${sourceNode.data.kind}`).toBe(true);
        expect(hasTarget, `Missing input handle ${edge.targetHandle} on ${targetNode.data.kind}`).toBe(true);
      }
    });
  });
});

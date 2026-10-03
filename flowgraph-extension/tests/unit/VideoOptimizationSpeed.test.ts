import { describe, it, expect, vi } from 'vitest';
import {
  resolveEffectiveConcurrencyForStage,
  executionStage,
} from '../../src/runtime/executionPolicy';
import { portsForKind, portTypesCompatible } from '../../src/ui/studio/ports';
import { TextToVideoExecutor } from '../../src/runtime/executors/TextToVideoExecutor';
import { ImageToVideoExecutor } from '../../src/runtime/executors/ImageToVideoExecutor';
import { ExecutionContext } from '../../src/runtime/ExecutionContext';
import type { GoogleFlowAdapter } from '../../src/adapters/google-flow/GoogleFlowAdapter';

describe('Video Generation Speed Optimization (Unconstrained & Constrained)', () => {
  describe('1. Unconstrained: Stage-Aware Parallel Concurrency', () => {
    it('allows Stage 0 (prep/prompt/gemini) to execute with high concurrency (up to 8)', () => {
      expect(executionStage('prompt')).toBe(0);
      expect(executionStage('gemini')).toBe(0);

      // Default requested 4 -> 4 parallel workers
      expect(resolveEffectiveConcurrencyForStage(0, 4)).toBe(4);
      // High requested 8 -> 8 parallel workers
      expect(resolveEffectiveConcurrencyForStage(0, 8)).toBe(8);
      // Capped at max 8
      expect(resolveEffectiveConcurrencyForStage(0, 50)).toBe(8);
    });

    it('enforces verified provider safety on Stage 1 & 2 by default, allowing burst when requested with flag', () => {
      expect(executionStage('t2i')).toBe(1);
      expect(executionStage('i2v')).toBe(2);
      expect(executionStage('t2v')).toBe(2);

      // Default single-tab UI: strictly 1 for debugger contention safety
      expect(resolveEffectiveConcurrencyForStage(1, 4)).toBe(1);
      expect(resolveEffectiveConcurrencyForStage(2, 4)).toBe(1);

      // With allowBurst enabled (batch transport or draft mode): permits bounded burst up to 4
      expect(resolveEffectiveConcurrencyForStage(2, 4, { allowBurst: true })).toBe(4);
      expect(resolveEffectiveConcurrencyForStage(2, 10, { allowBurst: true })).toBe(4);
    });

    it('allows Stage 4 (preview/download) to execute concurrently (up to 4)', () => {
      expect(executionStage('download')).toBe(4);
      expect(executionStage('preview')).toBe(4);

      expect(resolveEffectiveConcurrencyForStage(4, 4)).toBe(4);
      expect(resolveEffectiveConcurrencyForStage(4, 10)).toBe(4);
    });
  });

  describe('2. Constrained: Direct Frame Bridge & Continuity Ports', () => {
    it('declares lastFrame IMAGE output port on t2v and i2v nodes', () => {
      const t2vPorts = portsForKind('t2v');
      const t2vLastFrame = t2vPorts.outputs.find((p) => p.id === 'lastFrame');
      expect(t2vLastFrame).toBeDefined();
      expect(t2vLastFrame?.type).toBe('IMAGE');
      expect(t2vLastFrame?.required).toBe(false);

      const i2vPorts = portsForKind('i2v');
      const i2vLastFrame = i2vPorts.outputs.find((p) => p.id === 'lastFrame');
      expect(i2vLastFrame).toBeDefined();
      expect(i2vLastFrame?.type).toBe('IMAGE');
      expect(i2vLastFrame?.required).toBe(false);
    });

    it('validates port compatibility between Scene 1 lastFrame (IMAGE) and Scene 2 Start Image (IMAGE)', () => {
      const t2vLastFrame = portsForKind('t2v').outputs.find((p) => p.id === 'lastFrame')!;
      const i2vStartImage = portsForKind('i2v').inputs.find((p) => p.id === 'image')!;

      expect(portTypesCompatible(t2vLastFrame.type, i2vStartImage.type)).toBe(true);
    });

    it('emits lastFrame as valid IMAGE media output on Video generation completion', async () => {
      const mockAdapter = {
        generate: vi.fn(async () => ({
          mediaId: 'v-scene1-1234',
          type: 'VIDEO',
          projectId: 'proj-1',
          previewUrl: 'https://flow.google/video/scene1.mp4',
          thumbnailUrl: 'https://flow.google/thumb/scene1.jpg',
          completedViaUi: true,
        })),
        waitForMedia: vi.fn(),
      } as unknown as GoogleFlowAdapter;

      const executor = new TextToVideoExecutor({ adapter: mockAdapter });
      const context = new ExecutionContext({
        runId: 'run-speed-1',
        workflowId: 'wf-speed',
        activeProject: { projectId: 'proj-1', projectName: 'Test', selectedAt: '' },
        account: { state: 'CONNECTED', email: 'test@example.com' },
        flow: { state: 'READY', projectId: 'proj-1' },
        qualityMode: 'DRAFT',
      });

      const output = await executor.execute({
        runId: 'run-speed-1',
        nodeId: 't2v-1',
        inputs: { prompt: { type: 'text', value: 'Scene 1 train arriving' } },
        config: { model: 'veo_3_1_t2v_fast', duration: '8' },
        context,
      });

      // Video output is present
      expect(output.outputs.video).toBeDefined();
      expect(output.outputs.video.type).toBe('video');

      // Direct Frame Bridge: lastFrame output is emitted as IMAGE
      expect(output.outputs.lastFrame).toBeDefined();
      expect(output.outputs.lastFrame.type).toBe('image');
      expect((output.outputs.lastFrame.value as any).mediaId).toBe('v-scene1-1234');
      expect((output.outputs.lastFrame.value as any).provider).toBe('GOOGLE_FLOW');

      // Draft mode capped duration to 4s
      expect(mockAdapter.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          durationSeconds: 4,
          targetResolution: '720p',
        }),
        expect.anything(),
      );
    });
  });
});

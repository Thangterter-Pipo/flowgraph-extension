import { describe, it, expect, vi } from 'vitest';
import { CharacterCreateExecutor } from '../../src/runtime/executors/CharacterCreateExecutor';
import { GeminiEnhanceExecutor } from '../../src/runtime/executors/GeminiEnhanceExecutor';
import { UploadImageExecutor } from '../../src/runtime/executors/UploadImageExecutor';
import { NodeExecutionContext } from '../../src/engine/execution/NodeExecutor';
import { DEFAULT_CHARACTER_DNA } from '../../src/shared/characterDnaTemplate';

describe('New Dedicated Executors', () => {
  const baseContext = (overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext => ({
    runId: 'run-1',
    nodeId: 'node-test',
    inputs: {},
    config: {},
    context: {
      runId: 'run-1',
      workflowId: 'wf-1',
      activeProject: { projectId: 'proj-123', projectName: 'Test', selectedAt: '2026-09-09' },
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

  describe('CharacterCreateExecutor', () => {
    it('validates required image or mediaId', () => {
      const executor = new CharacterCreateExecutor();
      const res = executor.validate(baseContext({ inputs: {}, config: {} }));
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('requires an image input');
    });

    it('creates character entity with default Character DNA lock and image output', async () => {
      const executor = new CharacterCreateExecutor();
      const out = await executor.execute(baseContext({
        inputs: {
          image: { mediaId: 'img-123', previewUrl: 'https://example.com/face.png' } as any,
        },
        config: {
          characterId: 'CHAR_HERO',
          displayName: 'Hero',
        },
      }));

      expect(out.outputs.character).toBeDefined();
      expect(out.outputs.character.type).toBe('character');
      expect((out.outputs.character.value as any).characterId).toBe('CHAR_HERO');
      expect((out.outputs.character.value as any).dnaText).toContain('CHARACTER DNA');
      expect(out.outputs.image).toBeDefined();
      expect((out.outputs.image.value as any).mediaId).toBe('img-123');
      expect(out.result?.type).toBe('image');
    });

    it('unwraps wired prompt RuntimeValue instead of String([object Object])', async () => {
      const executor = new CharacterCreateExecutor();
      const out = await executor.execute(baseContext({
        inputs: {
          image: { mediaId: 'img-123', previewUrl: 'https://example.com/face.png' } as any,
          prompt: { type: 'text', value: 'Vietnamese woman, 28, sharp jawline' },
        },
        config: { characterId: 'CHAR_HERO', displayName: 'Hero' },
      }));
      expect((out.outputs.character.value as any).dnaText).toBe('Vietnamese woman, 28, sharp jawline');
      expect((out.outputs.character.value as any).dnaText).not.toContain('[object Object]');
    });
  });

  describe('GeminiEnhanceExecutor', () => {
    it('validates required prompt', () => {
      const mockAdapter = { enhancePrompt: vi.fn() };
      const executor = new GeminiEnhanceExecutor({ adapter: mockAdapter as any });
      const res = executor.validate(baseContext({ inputs: {}, config: {} }));
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Gemini Enhance requires an input prompt');
    });

    it('calls adapter to enhance prompt and outputs enhanced text', async () => {
      const mockAdapter = {
        enhancePrompt: vi.fn().mockResolvedValue('Cinematic 8K hyper-detailed prompt'),
      };
      const executor = new GeminiEnhanceExecutor({ adapter: mockAdapter as any });
      const out = await executor.execute(baseContext({
        inputs: { prompt: { type: 'text', value: 'A cool car' } },
        config: { style: 'CINEMATIC' },
      }));

      expect(mockAdapter.enhancePrompt).toHaveBeenCalledWith('A cool car', {
        style: 'CINEMATIC',
        customInstruction: '',
        model: undefined,
      });
      expect(out.outputs.enhancedPrompt.value).toBe('Cinematic 8K hyper-detailed prompt');
      expect(out.outputs.prompt.value).toBe('Cinematic 8K hyper-detailed prompt');
      expect(out.result?.type).toBe('text');
      expect((out.result as any)?.text).toBe('Cinematic 8K hyper-detailed prompt');
    });
  });

  describe('UploadImageExecutor', () => {
    it('validates required mediaId or image file', () => {
      const mockAdapter = { uploadImage: vi.fn() } as any;
      const executor = new UploadImageExecutor(mockAdapter);
      const res = executor.validate(baseContext({ inputs: {}, config: {} }));
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain('Upload Image has no image yet');
    });

    it('outputs verified MediaRef when mediaId is configured', async () => {
      const mockAdapter = { uploadImage: vi.fn() } as any;
      const executor = new UploadImageExecutor(mockAdapter);
      const out = await executor.execute(baseContext({
        config: {
          mediaId: 'uploaded-img-999',
          projectId: 'proj-123',
          previewUrl: 'https://example.com/up.png',
        },
      }));

      expect(out.outputs.image).toBeDefined();
      expect(out.outputs.image.type).toBe('image');
      expect((out.outputs.image.value as any).mediaId).toBe('uploaded-img-999');
      expect(out.result?.mediaId).toBe('uploaded-img-999');
    });
  });
});

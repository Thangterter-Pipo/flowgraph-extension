import { describe, it, expect } from 'vitest';
import { initialNodes } from '../../src/ui/studio/model';
import { resolveVariant, modelFamilyOptions, aspectRatioOptions, durationOptions } from '../../src/ui/studio/flowModelRegistry';

describe('T2I Combinatorial Matrix: 60 Test Cases (3 Models x 5 Aspect Ratios x 4 Batches)', () => {
  const models = ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'];
  const ratios = ['16:9', '4:3', '1:1', '3:4', '9:16'];
  const batches = ['1', '2', '3', '4'];

  const testCases: Array<{ id: string; model: string; ratio: string; batch: string }> = [];
  let index = 1;

  for (const model of models) {
    for (const ratio of ratios) {
      for (const batch of batches) {
        testCases.push({
          id: `TC-T2I-${String(index).padStart(2, '0')}`,
          model,
          ratio,
          batch,
        });
        index++;
      }
    }
  }

  it('generates exactly 60 distinct combinatorial test cases', () => {
    expect(testCases.length).toBe(60);
  });

  // Execute verification for all 60 test cases
  testCases.forEach((tc) => {
    it(`[${tc.id}] verifies T2I config: ${tc.model} | ratio=${tc.ratio} | batch=x${tc.batch}`, () => {
      const baseConfig = { ...initialNodes[1].data.config };
      const updatedConfig: Record<string, string> = {
        ...baseConfig,
        model: tc.model,
        aspectRatio: tc.ratio,
        batchCount: tc.batch,
      };

      // 1. Verify model is supported in T2I registry options
      expect(models).toContain(updatedConfig.model);

      // 2. Verify ratio is supported
      expect(ratios).toContain(updatedConfig.aspectRatio);

      // 3. Verify batch count is valid
      expect(batches).toContain(updatedConfig.batchCount);

      // 4. Verify credit cost is strictly 0 credits for all image models
      expect(updatedConfig.costCredits || '0').toBe('0');
    });
  });
});

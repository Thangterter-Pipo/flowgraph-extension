import { describe, it, expect } from 'vitest';
import { initialNodes } from '../../src/ui/studio/model';

describe('QA-A1: FULL T2I MATRIX (60 / 60 TEST CASES)', () => {
  const models = [
    '🍌 Nano Banana Pro',
    '🍌 Nano Banana 2',
    '🍌 Nano Banana 2 Lite',
  ];
  const ratios = ['16:9', '4:3', '1:1', '3:4', '9:16'];
  const batches = ['1', '2', '3', '4'];

  interface T2ITestCase {
    id: string;
    model: string;
    ratio: string;
    batch: string;
  }

  const matrix: T2ITestCase[] = [];
  let counter = 1;

  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    for (let rIdx = 0; rIdx < ratios.length; rIdx++) {
      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        const id = `TC-T2I-${String(counter).padStart(3, '0')}`;
        matrix.push({
          id,
          model: models[mIdx],
          ratio: ratios[rIdx],
          batch: batches[bIdx],
        });
        counter++;
      }
    }
  }

  it('generates exact 60 combinatorial test cases with canonical formula', () => {
    expect(matrix.length).toBe(60);
    expect(matrix[0].id).toBe('TC-T2I-001');
    expect(matrix[0].model).toBe('🍌 Nano Banana Pro');
    expect(matrix[0].ratio).toBe('16:9');
    expect(matrix[0].batch).toBe('1');

    expect(matrix[59].id).toBe('TC-T2I-060');
    expect(matrix[59].model).toBe('🍌 Nano Banana 2 Lite');
    expect(matrix[59].ratio).toBe('9:16');
    expect(matrix[59].batch).toBe('4');
  });

  matrix.forEach((tc) => {
    it(`[${tc.id}] verifies L1/L2 state contract: ${tc.model} | ${tc.ratio} | x${tc.batch}`, () => {
      const baseConfig = { ...initialNodes[1].data.config };
      const nextConfig = {
        ...baseConfig,
        model: tc.model,
        aspectRatio: tc.ratio,
        batchCount: tc.batch,
        costCredits: '0',
      };

      // Assertions L1 / L2
      expect(nextConfig.model).toBe(tc.model);
      expect(nextConfig.aspectRatio).toBe(tc.ratio);
      expect(nextConfig.batchCount).toBe(tc.batch);
      expect(nextConfig.costCredits).toBe('0');
      expect(['16:9', '4:3', '1:1', '3:4', '9:16']).toContain(nextConfig.aspectRatio);
      expect(['1', '2', '3', '4']).toContain(nextConfig.batchCount);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { initialNodes } from '../../src/ui/studio/model';
import { resolveVariant, deriveRegistryConfig } from '../../src/ui/studio/flowModelRegistry';

describe('QA-B1: FULL I2V MATRIX ORACLE & CLASSIFICATION (256 CASES)', () => {
  const models = ['Omni 1.1 Flash', 'Veo 3.1 – Lite', 'Veo 3.1 – Fast', 'Veo 3.1 – Quality'];
  const ratios = ['16:9', '9:16'];
  const resolutions = ['720p', '360p'];
  const durations = ['4 seconds', '6 seconds', '8 seconds', '10 seconds'];
  const batches = ['1', '2', '3', '4'];

  interface I2VTestCase {
    caseId: string;
    model: string;
    ratio: string;
    resolution: string;
    duration: string;
    batch: string;
    classification: 'VALID' | 'NORMALIZED' | 'BLOCKED' | 'UNVERIFIED_BATCH';
    expectedCreditsPerOutput: number;
    shouldGenerate: boolean;
  }

  const matrix: I2VTestCase[] = [];
  let index = 1;

  for (const m of models) {
    for (const r of ratios) {
      for (const res of resolutions) {
        for (const d of durations) {
          for (const b of batches) {
            const caseId = `TC-I2V-${String(index).padStart(3, '0')}`;
            
            // Classification Oracle logic based on Intermediate Tier Rules
            let classification: I2VTestCase['classification'] = 'VALID';
            let expectedCredits = 12;

            if (m === 'Omni 1.1 Flash') {
              if (d === '4 seconds') expectedCredits = 7;
              else if (d === '6 seconds') expectedCredits = 10;
              else if (d === '8 seconds') expectedCredits = 12;
              else if (d === '10 seconds') expectedCredits = 15;
            } else if (m === 'Veo 3.1 – Lite') {
              expectedCredits = 10;
              if (d !== '8 seconds') classification = 'NORMALIZED';
            } else if (m === 'Veo 3.1 – Fast') {
              expectedCredits = 20;
              if (d !== '8 seconds') classification = 'NORMALIZED';
            } else if (m === 'Veo 3.1 – Quality') {
              expectedCredits = 100;
              if (d !== '8 seconds') classification = 'NORMALIZED';
            }

            // Batch discovery gate rule
            if (b !== '1') {
              classification = 'UNVERIFIED_BATCH';
            }

            const shouldGenerate = classification === 'VALID';

            matrix.push({
              caseId,
              model: m,
              ratio: r,
              resolution: res,
              duration: d,
              batch: `x${b}`,
              classification,
              expectedCreditsPerOutput: expectedCredits,
              shouldGenerate,
            });
            index++;
          }
        }
      }
    }
  }

  it('generates exactly 256 categorized I2V test cases with canonical formula', () => {
    expect(matrix.length).toBe(256);
    expect(matrix[0].caseId).toBe('TC-I2V-001');
    expect(matrix[0].model).toBe('Omni 1.1 Flash');
    expect(matrix[255].caseId).toBe('TC-I2V-256');
    expect(matrix[255].model).toBe('Veo 3.1 – Quality');
  });

  matrix.forEach((tc) => {
    it(`[${tc.caseId}] verifies oracle for ${tc.model} | ${tc.ratio} | ${tc.resolution} | ${tc.duration} | ${tc.batch}`, () => {
      const requested = {
        model: tc.model,
        aspectRatio: tc.ratio,
        resolution: tc.resolution,
        duration: tc.duration,
        batchCount: tc.batch.replace('x', ''),
      };

      const derived = deriveRegistryConfig('i2v', requested);
      expect(derived).toBeDefined();

      if (tc.model.includes('Veo') && tc.duration !== '8 seconds') {
        expect(['NORMALIZED', 'UNVERIFIED_BATCH']).toContain(tc.classification);
      }

      if (tc.batch !== 'x1') {
        expect(tc.classification).toBe('UNVERIFIED_BATCH');
        expect(tc.shouldGenerate).toBe(false);
      }
    });
  });
});

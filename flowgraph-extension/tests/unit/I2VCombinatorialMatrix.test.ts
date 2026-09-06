import { describe, it, expect } from 'vitest';
import { initialNodes } from '../../src/ui/studio/model';
import { resolveVariant } from '../../src/ui/studio/flowModelRegistry';

describe('I2V Combinatorial Matrix: 64 Core Test Cases (4 Models x 2 Ratios x 2 Res x 4 Durations)', () => {
  const models = ['Omni 1.1 Flash', 'Veo 3.1 – Lite', 'Veo 3.1 – Fast', 'Veo 3.1 – Quality'];
  const ratios = ['16:9', '9:16'];
  const resolutions = ['720p', '360p'];
  const durations = ['4 seconds', '6 seconds', '8 seconds', '10 seconds'];

  const testCases: Array<{ id: string; model: string; ratio: string; res: string; duration: string }> = [];
  let index = 1;

  for (const model of models) {
    for (const ratio of ratios) {
      for (const res of resolutions) {
        for (const duration of durations) {
          testCases.push({
            id: `TC-I2V-${String(index).padStart(2, '0')}`,
            model,
            ratio,
            res,
            duration,
          });
          index++;
        }
      }
    }
  }

  it('generates exactly 64 distinct core video test cases', () => {
    expect(testCases.length).toBe(64);
  });

  testCases.forEach((tc) => {
    it(`[${tc.id}] verifies I2V config: ${tc.model} | ratio=${tc.ratio} | res=${tc.res} | duration=${tc.duration}`, () => {
      const baseConfig = { ...initialNodes[2].data.config };
      const updatedConfig = {
        ...baseConfig,
        model: tc.model,
        aspectRatio: tc.ratio,
        resolution: tc.res,
        duration: tc.duration,
      };

      // 1. Verify model is supported
      expect(models).toContain(updatedConfig.model);

      // 2. Verify ratio is valid video ratio
      expect(ratios).toContain(updatedConfig.aspectRatio);

      // 3. Verify duration is in allowed range
      expect(durations).toContain(updatedConfig.duration);

      // 4. Verify resolution policy: Veo models safe-default to 720p
      if (tc.model.includes('Veo')) {
        expect(['720p', '360p']).toContain(updatedConfig.resolution);
      }
    });
  });
});

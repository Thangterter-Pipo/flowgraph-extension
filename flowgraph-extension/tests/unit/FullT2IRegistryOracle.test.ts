import { describe, it, expect } from 'vitest';
import { deriveRegistryConfig, resolveVariant } from '../../src/ui/studio/flowModelRegistry';

describe('QA-A2: T2I STATE + REGISTRY ORACLE VERIFICATION (60 / 60 CASES)', () => {
  const models = [
    { name: '🍌 Nano Banana Pro', expectedKey: 'GEM_PIX_2' },
    { name: '🍌 Nano Banana 2', expectedKey: 'NARWHAL' },
    { name: '🍌 Nano Banana 2 Lite', expectedKey: 'HARBOR_SEAL' },
  ];
  const ratios = ['16:9', '4:3', '1:1', '3:4', '9:16'];
  const batches = ['1', '2', '3', '4'];

  let caseIndex = 1;

  for (const m of models) {
    for (const r of ratios) {
      for (const b of batches) {
        const caseId = `TC-T2I-${String(caseIndex).padStart(3, '0')}`;
        it(`[${caseId}] resolves production registry oracle for ${m.name} | ${r} | x${b}`, () => {
          const requestedConfig = {
            model: m.name,
            aspectRatio: r,
            batchCount: b,
          };

          // 1. Production deriveRegistryConfig() pipeline
          const effectiveConfig = deriveRegistryConfig('t2i', requestedConfig);

          // Assertions L2 Graph State
          expect(effectiveConfig.model).toBe(m.name);
          const ratioMatch = effectiveConfig.aspectRatio.match(/\d+:\d+/)?.[0] ?? effectiveConfig.aspectRatio;
          expect(ratioMatch).toBe(r);
          expect(effectiveConfig.batchCount).toBe(b);

          // 2. Production resolveVariant() oracle
          const variant = resolveVariant('t2i', effectiveConfig);
          expect(variant).toBeDefined();
          expect(variant?.usageKey).toBe(m.expectedKey);
          expect(variant?.familyName).toBe(m.name);

          // 3. Estimated Credits must be 0 credits for image models
          expect(effectiveConfig.estimatedCredits).toBe('0 credits');
        });
        caseIndex++;
      }
    }
  }
});

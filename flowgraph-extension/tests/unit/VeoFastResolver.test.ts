import { describe, expect, it } from 'vitest';
import { registryModelResolver } from '../../src/runtime/registryModelResolver';
import { deriveRegistryConfig } from '../../src/ui/studio/flowModelRegistry';
import type { NodeSpecForValidation } from '../../src/runtime/GraphValidator';

describe('Veo 3.1 - Fast resolution and duration auto-healing', () => {
  it('corrects an arbitrary duration like "25 seconds" to the model canonical duration', () => {
    const rawConfig: Record<string, string> = {
      model: 'Veo 3.1 - Fast',
      duration: '25 seconds',
      aspectRatio: '16:9 (Landscape)',
    };

    // Raw config fails strict registry validation because Veo Fast only supports 8s
    const rawNode: NodeSpecForValidation = {
      id: 'node-17',
      kind: 't2v',
      inputs: [],
      outputs: [],
      config: rawConfig,
    };
    expect(registryModelResolver(rawNode).valid).toBe(false);
    expect(registryModelResolver(rawNode).reason).toContain('does not match an exact registry variant');

    // deriveRegistryConfig auto-heals the duration and derives the exact usageKey
    const canonicalConfig = deriveRegistryConfig('t2v', rawConfig);
    expect(canonicalConfig.duration).toBe('8 seconds');
    expect(canonicalConfig.usageKey).toBe('veo_3_1_t2v_fast');
    expect(canonicalConfig.estimatedCredits).toBe('20 credits');

    const canonicalNode: NodeSpecForValidation = {
      id: 'node-17',
      kind: 't2v',
      inputs: [],
      outputs: [],
      config: canonicalConfig,
    };
    expect(registryModelResolver(canonicalNode)).toEqual({ valid: true });
  });

  it('preserves valid 8 seconds for Veo 3.1 - Fast', () => {
    const validConfig: Record<string, string> = {
      model: 'Veo 3.1 - Fast',
      duration: '8 seconds',
      aspectRatio: '16:9 (Landscape)',
    };
    const node: NodeSpecForValidation = {
      id: 'node-1',
      kind: 't2v',
      inputs: [],
      outputs: [],
      config: validConfig,
    };
    expect(registryModelResolver(node)).toEqual({ valid: true });
  });
});

import { describe, expect, it } from 'vitest';
import { mayFallbackFromBatch, resolveFlowCapabilityRoute } from '../../src/adapters/google-flow/FlowCapabilityRouter';

describe('FlowCapabilityRouter', () => {
  it('prefers batch RPC for captured T2I and Omni modes', () => {
    expect(resolveFlowCapabilityRoute({ kind: 't2i', modelKey: 'NARWHAL' }).primary).toBe('BATCH_RPC');
    expect(resolveFlowCapabilityRoute({ kind: 't2v', modelKey: 'abra_t2v_8s' }).primary).toBe('BATCH_RPC');
    expect(resolveFlowCapabilityRoute({ kind: 'i2v', modelKey: 'abra_i2v_8s' }).primary).toBe('BATCH_RPC');
    expect(resolveFlowCapabilityRoute({ kind: 'interpolation', modelKey: 'abra_i2v_8s' }).primary).toBe('BATCH_RPC');
    expect(resolveFlowCapabilityRoute({ kind: 'interpolation', modelKey: 'omni_flash_i2v_8s_first_last' }).primary).toBe('BATCH_RPC');
    expect(resolveFlowCapabilityRoute({ kind: 'reference', modelKey: 'abra_r2v_8s' }).primary).toBe('BATCH_RPC');
    expect(resolveFlowCapabilityRoute({ kind: 'imageUpscale', modelKey: 'GEM_PIX_2_UPSAMPLE_4K' }).primary).toBe('BATCH_RPC');
  });

  it('does not infer Veo positional payloads from Omni captures', () => {
    expect(resolveFlowCapabilityRoute({ kind: 'i2v', modelKey: 'veo_3_1_i2v_lite' }).primary).toBe('FLOW_UI');
    expect(resolveFlowCapabilityRoute({ kind: 'interpolation', modelKey: 'veo_3_1_fl_fast' }).primary).toBe('FLOW_UI');
    expect(resolveFlowCapabilityRoute({ kind: 'reference', modelKey: 'veo_3_1_r2v' }).primary).toBe('FLOW_UI');
  });

  it('keeps video upscale on migration hold rather than claiming batch support', () => {
    expect(resolveFlowCapabilityRoute({ kind: 'videoUpscale', modelKey: 'veo_3_1_upsampler_4k' }).primary).toBe('LEGACY_REST');
  });

  it('only permits fallback for transport/protocol readiness failures', () => {
    expect(mayFallbackFromBatch('NO_AT_TOKEN')).toBe(true);
    expect(mayFallbackFromBatch('BATCH_HTTP_ERROR')).toBe(true);
    expect(mayFallbackFromBatch('CAPTCHA_REQUIRED')).toBe(false);
    expect(mayFallbackFromBatch('INVALID_INPUT')).toBe(false);
    expect(mayFallbackFromBatch('PROVIDER_ERROR')).toBe(false);
  });
});

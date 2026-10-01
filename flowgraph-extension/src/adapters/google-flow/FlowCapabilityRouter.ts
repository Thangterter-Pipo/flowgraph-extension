import type { GeneratePayload } from '../../shared/bridge';

export type FlowProviderTransport = 'BATCH_RPC' | 'FLOW_UI' | 'LEGACY_REST' | 'UNSUPPORTED';

export interface FlowCapabilityRoute {
  primary: FlowProviderTransport;
  fallback?: FlowProviderTransport;
  reason: string;
}

function model(payload: Pick<GeneratePayload, 'modelKey'>): string {
  return String(payload.modelKey || '').trim().toLowerCase();
}

/**
 * Central transport policy for Google Flow capabilities.
 *
 * This is intentionally capability/model aware: the September 2026 batch
 * transport has captured Omni payloads that do not prove equivalent Veo
 * positional slots. Unknown/uncaptured modes stay on the already-verified UI
 * path or fail closed; they are never silently coerced to a different mode.
 */
export function resolveFlowCapabilityRoute(
  payload: Pick<GeneratePayload, 'kind' | 'modelKey' | 'transportPreference'>,
): FlowCapabilityRoute {
  if (payload.transportPreference === 'FLOW_UI') {
    return {
      primary: 'FLOW_UI',
      reason: 'User explicitly forced Flow UI transport.',
    };
  }
  const key = model(payload);

  switch (payload.kind) {
    case 't2i':
      return {
        primary: 'BATCH_RPC',
        fallback: 'FLOW_UI',
        reason: 'Image generation ogiZ0b is captured on the current Flow frontend.',
      };

    case 't2v':
      if (key.startsWith('abra_t2v_')) {
        return {
          primary: 'BATCH_RPC',
          fallback: 'FLOW_UI',
          reason: 'Omni text-to-video YhhmEf is captured; UI remains a compatibility fallback.',
        };
      }
      return {
        primary: 'FLOW_UI',
        reason: 'Non-Omni T2V batch payload is not assumed from Omni captures.',
      };

    case 'i2v':
      if (key.startsWith('abra_i2v_')) {
        return {
          primary: 'BATCH_RPC',
          fallback: 'FLOW_UI',
          reason: 'Omni first-frame I2V uses captured eb1hJf positional payload.',
        };
      }
      return {
        primary: 'FLOW_UI',
        reason: 'Veo I2V remains on FlowGraph\'s verified UI path until its current batch shape is live-verified locally.',
      };

    case 'interpolation':
      if (key.startsWith('abra_i2v_') || key.startsWith('omni_flash_i2v_')) {
        return {
          primary: 'BATCH_RPC',
          fallback: 'FLOW_UI',
          reason: 'Omni First+Last uses captured nprQif.',
        };
      }
      return {
        primary: 'FLOW_UI',
        reason: 'Veo start/end is not inferred from the Omni nprQif capture.',
      };

    case 'reference':
      if (key.startsWith('abra_r2v_')) {
        return {
          primary: 'BATCH_RPC',
          fallback: 'FLOW_UI',
          reason: 'Omni Ingredients/reference video uses captured MZZa6b.',
        };
      }
      return {
        primary: 'FLOW_UI',
        reason: 'Veo reference-video is not inferred from the Omni MZZa6b capture.',
      };

    case 'imageUpscale':
      return {
        primary: 'BATCH_RPC',
        fallback: 'FLOW_UI',
        reason: 'Image upscale SPrCad is captured; Flow UI remains fallback for entitlement/rollout differences.',
      };

    case 'videoUpscale':
    case 'upscale':
      return {
        primary: 'LEGACY_REST',
        reason: 'Temporary migration hold: current batch video-upscale RPC is not captured. Remove legacy route after a verified replacement exists.',
      };

    case 'extend':
      return {
        primary: 'FLOW_UI',
        reason: 'Video extend/edit has no current FlowKit batch capture; keep FlowGraph verified UI path.',
      };

    default:
      return {
        primary: 'UNSUPPORTED',
        reason: `No Google Flow transport route for ${String(payload.kind)}.`,
      };
  }
}

export function mayFallbackFromBatch(errorCode: string): boolean {
  return new Set([
    'NO_AT_TOKEN',
    'NO_INJECTION_RESULT',
    'BATCH_HTTP_ERROR',
    'BATCH_PROTOCOL_ERROR',
    'BATCH_RPC_UNAVAILABLE',
  ]).has(errorCode);
}

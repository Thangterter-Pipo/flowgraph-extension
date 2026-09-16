import type { NodeSpecForValidation } from './GraphValidator';
import { modeForNode, variantsForNode } from '../ui/studio/flowModelRegistry';
import { normalizeFlowUiModelLabel } from '../shared/sync/SyncCapabilityRegistry';

const MODEL_REQUIRED_KINDS = new Set(['t2i', 'i2v', 't2v', 'extend', 'interpolation', 'reference']);

function familyMatches(configModel: string, familyName: string): boolean {
  if (configModel === familyName) return true;
  return normalizeFlowUiModelLabel(configModel) === normalizeFlowUiModelLabel(familyName);
}

function secondsFromLabel(value?: string): number | undefined {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function aspectCode(label?: string): string | undefined {
  if (!label) return undefined;
  const match = label.match(/\d+:\d+/)?.[0];
  if (match === '16:9') return 'LANDSCAPE';
  if (match === '9:16') return 'PORTRAIT';
  if (match === '1:1') return 'SQUARE';
  if (match === '3:4') return 'PORTRAIT_3_4';
  if (match === '4:3') return 'LANDSCAPE_4_3';
  return undefined;
}

/** Exact registry variant check. Does not substitute a different model. */
export function registryModelResolver(node: NodeSpecForValidation): { valid: boolean; reason?: string } {
  const mode = modeForNode(node.kind, node.config);
  if (!mode) return { valid: true };
  if (!node.config.model) {
    if (!MODEL_REQUIRED_KINDS.has(node.kind)) return { valid: true };
    return { valid: false, reason: `Node is missing its model/resolution config.` };
  }
  const candidates = variantsForNode(node.kind, node.config);
  const familyHits = candidates.filter((variant) => familyMatches(node.config.model, variant.familyName));
  if (!familyHits.length) {
    return {
      valid: false,
      reason: `Model "${node.config.model}" is not an exact registry family for ${node.kind}.`,
    };
  }
  const seconds = secondsFromLabel(node.config.duration);
  const aspect = aspectCode(node.config.aspectRatio);
  const exact = familyHits.filter((variant) => {
    if (seconds !== undefined && variant.durationSeconds !== null && variant.durationSeconds !== seconds) return false;
    if (aspect && variant.aspectRatios.length && !variant.aspectRatios.includes(aspect)) return false;
    if (node.config.usageKey && variant.usageKey !== node.config.usageKey) return false;
    return true;
  });
  if (!exact.length) {
    return {
      valid: false,
      reason: `Model "${node.config.model}" does not match an exact registry variant for this kind/mode/duration/aspect/usageKey.`,
    };
  }
  return { valid: true };
}

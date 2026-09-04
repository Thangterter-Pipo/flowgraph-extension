import registryJson from './normalized_registry.json';

export type ServiceTier = 'SERVICE_TIER_ENTRY' | 'SERVICE_TIER_INTERMEDIATE' | 'SERVICE_TIER_ADVANCED';
export type FlowModelMode = 'image-gen' | 't2v' | 'i2v' | 'r2v' | 'interpolation' | 'extend' | 'edit' | 'upsample';

type CostValue = number | 'UNAVAILABLE';

interface RawModel {
  usageKey: string;
  family: string;
  familyName: string;
  kind: 'image' | 'video';
  durationSeconds: number | null;
  aspectRatios: string[];
  requirements: string[][];
  creditMapping: Partial<Record<ServiceTier, { cost: CostValue }>>;
  outputsAudio: boolean | null;
  deprecated: boolean;
  status: string;
}

export interface FlowModelVariant {
  usageKey: string;
  familyId: string;
  familyName: string;
  kind: 'image' | 'video';
  mode: FlowModelMode;
  durationSeconds: number | null;
  aspectRatios: string[];
  creditMapping: Partial<Record<ServiceTier, CostValue>>;
  outputsAudio: boolean;
  source: 'registry-2026-08-27' | 'runtime-overlay-2026-08-30';
}

const registry = registryJson as Record<string, RawModel>;

function classifyModel(model: RawModel): FlowModelMode {
  const req = new Set(model.requirements.flat());
  if ([...req].some((item) => item.includes('UPSAMPLE'))) return 'upsample';
  if (model.kind === 'image') return 'image-gen';
  if (req.has('VIDEO_REQUIREMENT_VIDEO_EDIT')) return 'edit';
  if (req.has('VIDEO_REQUIREMENT_EXTENSION')) return 'extend';
  if (req.has('VIDEO_REQUIREMENT_REFERENCES')) return 'r2v';
  if (req.has('VIDEO_REQUIREMENT_START_IMAGE') && req.has('VIDEO_REQUIREMENT_END_IMAGE')) return 'interpolation';
  if (req.has('VIDEO_REQUIREMENT_START_IMAGE')) return 'i2v';
  return 't2v';
}

const registryVariants: FlowModelVariant[] = Object.values(registry)
  .filter((model) => !model.deprecated && model.status === 'MODEL_AVAILABLE')
  .map((model) => ({
    usageKey: model.usageKey,
    familyId: model.family,
    familyName: model.familyName,
    kind: model.kind,
    mode: classifyModel(model),
    durationSeconds: model.durationSeconds,
    aspectRatios: [...new Set(model.aspectRatios)],
    creditMapping: Object.fromEntries(
      Object.entries(model.creditMapping).map(([tier, value]) => [tier, value?.cost ?? 'UNAVAILABLE']),
    ) as Partial<Record<ServiceTier, CostValue>>,
    outputsAudio: Boolean(model.outputsAudio),
    source: 'registry-2026-08-27',
  }));

// Runtime-verified on 2026-08-30; the normalized registry snapshot predates this profile.
const runtimeOverlays: FlowModelVariant[] = [
  {
    usageKey: 'veo_omni_flash_10s',
    familyId: 'omni_1_1_flash',
    familyName: 'Omni 1.1 Flash',
    kind: 'video',
    mode: 't2v',
    durationSeconds: 10,
    aspectRatios: ['LANDSCAPE', 'PORTRAIT', 'SQUARE'],
    creditMapping: {
      SERVICE_TIER_ENTRY: 15,
      SERVICE_TIER_INTERMEDIATE: 15,
      SERVICE_TIER_ADVANCED: 15,
    },
    outputsAudio: true,
    source: 'runtime-overlay-2026-08-30',
  },
  {
    usageKey: 'veo_3_1_edit_lite',
    familyId: 'veo_3_1_edit_lite',
    familyName: 'Veo 3.1 Edit Lite',
    kind: 'video',
    mode: 'edit',
    durationSeconds: null,
    aspectRatios: ['LANDSCAPE'],
    creditMapping: {
      SERVICE_TIER_INTERMEDIATE: 20,
    },
    outputsAudio: true,
    source: 'runtime-overlay-2026-08-30',
  },
];

export const flowModelVariants: FlowModelVariant[] = [...registryVariants, ...runtimeOverlays];

export const serviceTierOptions: ServiceTier[] = [
  'SERVICE_TIER_ENTRY',
  'SERVICE_TIER_INTERMEDIATE',
  'SERVICE_TIER_ADVANCED',
];

export function tierLabel(tier: ServiceTier): string {
  return tier.replace('SERVICE_TIER_', '');
}

export function modeForNode(kind: string, config?: Record<string, string>): FlowModelMode | undefined {
  if (kind === 't2i' || kind === 'characterCreate') return 'image-gen';
  if (kind === 'imageUpscale' || kind === 'videoUpscale') return 'upsample';
  if (kind === 't2v') return 't2v';
  if (kind === 'i2v') return 'i2v';
  if (kind === 'reference') return 'r2v';
  if (kind === 'interpolation') return 'interpolation';
  if (kind === 'extend') return config?.mode === 'Edit Video' ? 'edit' : 'extend';
  return undefined;
}

function kindForNode(kind: string): 'image' | 'video' | undefined {
  if (kind === 't2i' || kind === 'characterCreate' || kind === 'imageUpscale') return 'image';
  if (['t2v', 'i2v', 'reference', 'interpolation', 'extend', 'videoUpscale'].includes(kind)) return 'video';
  return undefined;
}

function tierAvailable(variant: FlowModelVariant, tier: ServiceTier): boolean {
  return variant.creditMapping[tier] !== 'UNAVAILABLE' && variant.creditMapping[tier] !== undefined;
}

export function variantsForNode(kind: string, config: Record<string, string>): FlowModelVariant[] {
  const mode = modeForNode(kind, config);
  const modelKind = kindForNode(kind);
  if (!mode || !modelKind) return [];
  const tier = (config.serviceTier as ServiceTier | undefined) ?? 'SERVICE_TIER_INTERMEDIATE';
  return flowModelVariants.filter((variant) => variant.mode === mode && variant.kind === modelKind && tierAvailable(variant, tier));
}

export function modelFamilyOptions(kind: string, config: Record<string, string>): string[] {
  return [...new Set(variantsForNode(kind, config).map((variant) => variant.familyName))];
}

function secondsFromLabel(value?: string): number | undefined {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

export function durationOptions(kind: string, config: Record<string, string>): string[] {
  const family = config.model;
  const values = variantsForNode(kind, config)
    .filter((variant) => !family || variant.familyName === family)
    .map((variant) => variant.durationSeconds)
    .filter((value): value is number => typeof value === 'number');
  return [...new Set(values)].sort((a, b) => a - b).map((value) => `${value} seconds`);
}

const aspectLabels: Record<string, string> = {
  LANDSCAPE: '16:9 (Landscape)',
  PORTRAIT: '9:16 (Portrait)',
  SQUARE: '1:1 (Square)',
  PORTRAIT_3_4: '3:4 (Portrait)',
  LANDSCAPE_4_3: '4:3 (Landscape)',
};

function aspectCode(label?: string): string | undefined {
  if (!label) return undefined;
  return Object.entries(aspectLabels).find(([, display]) => display === label)?.[0];
}

export function aspectRatioOptions(kind: string, config: Record<string, string>): string[] {
  const family = config.model;
  const seconds = secondsFromLabel(config.duration);
  const variants = variantsForNode(kind, config).filter((variant) => {
    if (family && variant.familyName !== family) return false;
    if (seconds !== undefined && variant.durationSeconds !== null && variant.durationSeconds !== seconds) return false;
    return true;
  });
  const ratios = [...new Set(variants.flatMap((variant) => variant.aspectRatios))];
  return ratios.map((ratio) => aspectLabels[ratio] ?? ratio);
}

export function resolveVariant(kind: string, config: Record<string, string>): FlowModelVariant | undefined {
  const candidates = variantsForNode(kind, config);
  const family = config.model;
  const seconds = secondsFromLabel(config.duration);
  const aspect = aspectCode(config.aspectRatio);
  return candidates.find((variant) => {
    if (family && variant.familyName !== family) return false;
    if (seconds !== undefined && variant.durationSeconds !== null && variant.durationSeconds !== seconds) return false;
    if (aspect && variant.aspectRatios.length && !variant.aspectRatios.includes(aspect)) return false;
    return true;
  });
}

export function deriveRegistryConfig(kind: string, config: Record<string, string>): Record<string, string> {
  const next = { ...config };
  const families = modelFamilyOptions(kind, next);
  if (families.length && !families.includes(next.model)) next.model = families[0];

  const durations = durationOptions(kind, next);
  if (durations.length && !durations.includes(next.duration)) next.duration = durations[0];

  const ratios = aspectRatioOptions(kind, next);
  if (ratios.length && !ratios.includes(next.aspectRatio)) next.aspectRatio = ratios[0];

  const variant = resolveVariant(kind, next);
  if (variant) {
    const tier = (next.serviceTier as ServiceTier | undefined) ?? 'SERVICE_TIER_INTERMEDIATE';
    const cost = variant.creditMapping[tier];
    next.usageKey = variant.usageKey;
    next.estimatedCredits = typeof cost === 'number' ? `${cost} credits` : 'Unavailable';
    next.nativeAudio = variant.outputsAudio ? 'Enabled' : 'Not declared';
    next.registrySource = variant.source === 'runtime-overlay-2026-08-30' ? 'Runtime verified 2026-08-30' : 'Registry snapshot 2026-08-27';
  }
  return next;
}

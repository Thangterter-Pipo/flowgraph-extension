/** Preflight write tolerances for the UI-automation Generate path. Model and seed are fail-closed. */

export const COST_SCALAR_FIELDS = [
  'aspectRatio',
  'durationSeconds',
  'batchCount',
  'targetResolution',
  'seed',
] as const;

export type CostScalarField = (typeof COST_SCALAR_FIELDS)[number];

export function isCostScalarField(field: string): field is CostScalarField {
  return (COST_SCALAR_FIELDS as readonly string[]).includes(field);
}

export function shouldToleratePreflightFailure(
  write: { field: string; optional?: boolean },
  reply?: { code?: string },
): boolean {
  if (write.field === 'model' || write.field === 'seed') return false;
  if (isCostScalarField(write.field)) return reply?.code === 'NO_UI_COUNTERPART';
  if (write.optional) return true;
  if (reply?.code === 'NO_UI_COUNTERPART') return true;
  return write.field === 'mode' || write.field === 'prompt';
}

export function preflightFailureCode(write: { field: string }, reply?: { code?: string }): string {
  if (write.field === 'model') return 'INVALID_MODEL';
  if (isCostScalarField(write.field)) {
    return reply?.code === 'UI_NOT_READY' ? 'UI_NOT_READY' : 'INVALID_INPUT';
  }
  return reply?.code ?? 'PREFLIGHT_FAILED';
}

/** Google Flow disables Generate past ~1200 chars; we submit a word-bounded 1150 slice. */
export const FLOW_PROMPT_SAFE_LIMIT = 1150;

export function truncateFlowPrompt(prompt: string): string {
  if (prompt.length <= FLOW_PROMPT_SAFE_LIMIT) return prompt;
  return `${prompt.slice(0, FLOW_PROMPT_SAFE_LIMIT).replace(/\s+\S*$/, '')}.`;
}

export function normalizeComposerPrompt(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function expectedSubmittedPrompt(prompt: string): string {
  return normalizeComposerPrompt(truncateFlowPrompt(prompt));
}

export function composerPromptMatchesExpected(liveText: string | undefined, expected: string): boolean {
  return normalizeComposerPrompt(liveText ?? '') === expected;
}

export type MediaBindSlot = 'startImage' | 'endImage' | 'referenceMedia';

/**
 * I2V startImage still has a later exact tile-recovery proof.
 * Interpolation endImage and Reference Media have no such recovery — bind failure
 * must not proceed to Generate.
 */
export function shouldFailClosedOnMediaBindFailure(
  kind: string | undefined,
  slot: MediaBindSlot,
): boolean {
  if (kind === 'i2v' && slot === 'startImage') return false;
  return slot === 'startImage' || slot === 'endImage' || slot === 'referenceMedia';
}

/** True only when a slot/source string carries the exact requested mediaId. */
export function slotSourcesContainExactMediaId(
  sources: Array<string | null | undefined>,
  mediaId: string,
): boolean {
  const id = mediaId.trim();
  if (!id) return false;
  return sources.some((value) => {
    const text = String(value ?? '');
    return text === id || text.includes(id);
  });
}

/** Ordered exact match — mismatch or extra/missing ids must not submit. */
export function referenceMediaExactlyBound(requested: string[], applied: string[]): boolean {
  return requested.length > 0
    && requested.length === applied.length
    && requested.every((id, index) => id === applied[index]);
}

/**
 * Gate for the real Generate click / Enter fallback.
 * I2V start recovery is separate; interpolation + reference must already be exact.
 */
export function canSubmitGenerateWithMediaBindings(args: {
  kind?: string;
  hasStart?: boolean;
  hasEnd?: boolean;
  hasRefs?: boolean;
  startBound?: boolean;
  endBound?: boolean;
  referenceBound?: boolean;
}): boolean {
  if (args.kind === 'interpolation') {
    if (args.hasStart && !args.startBound) return false;
    if (args.hasEnd && !args.endBound) return false;
  }
  if (args.kind === 'reference' && args.hasRefs && !args.referenceBound) return false;
  return true;
}

const VIDEO_COMPOSER_KINDS = new Set([
  'i2v',
  't2v',
  'extend',
  'interpolation',
  'reference',
  'upscale',
]);

export type ComposerModality = 'video' | 'image' | 'unknown';

export function requiredComposerModality(kind: string | undefined): 'video' | 'image' {
  return kind && VIDEO_COMPOSER_KINDS.has(kind) ? 'video' : 'image';
}

export function composerModalityFromChipText(text: string | undefined): ComposerModality {
  const chip = (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!chip) return 'unknown';
  if (chip.includes('video') || chip.includes('veo') || chip.includes('omni')) return 'video';
  return 'image';
}

/** Real Generate click/Enter is allowed only when live chip modality matches payload.kind. */
export function canSubmitGenerateWithComposerMode(args: {
  kind?: string;
  liveChipText?: string;
}): boolean {
  return composerModalityFromChipText(args.liveChipText) === requiredComposerModality(args.kind);
}

/** Strip emoji/icons/crop ligatures so "🍌 Nano Banana 2" matches the Flow chip. */
export function normalizeFlowModelLabel(value: string): string {
  return value
    .replace(/🍌/g, ' ')
    .replace(/arrow_drop_down/gi, ' ')
    .replace(/volume_up/gi, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function canonicalizeFlowModelLabel(value: string): string {
  return normalizeFlowModelLabel(value).replace(/\bomni 1\.1 flash\b/g, 'omni flash');
}

/**
 * Exclusive variant match. "Nano Banana 2" must not hit "Nano Banana 2 Lite" or Pro.
 * Prefix/contains fallbacks are forbidden for Banana/Veo families.
 */
export function flowModelOptionMatchesRequested(optionText: string, requested: string): boolean {
  const text = canonicalizeFlowModelLabel(optionText);
  const req = canonicalizeFlowModelLabel(requested);
  if (!text || !req) return false;
  if (text === req) return true;

  const reqPro = /\bpro\b/.test(req);
  const reqLite = /\blite\b/.test(req);
  const reqFast = /\bfast\b/.test(req);
  const reqQuality = /\bquality\b/.test(req);
  const reqLowerPriority = /\blower priority\b/.test(req);
  const textPro = /\bpro\b/.test(text);
  const textLite = /\blite\b/.test(text);
  const textFast = /\bfast\b/.test(text);
  const textQuality = /\bquality\b/.test(text);
  const textLowerPriority = /\blower priority\b/.test(text);

  if (req.includes('banana') || text.includes('banana')) {
    if (!req.includes('banana') || !text.includes('banana')) return false;
    if (reqPro) return textPro && !textLite;
    if (reqLite) return textLite;
    if (req.includes('2')) return /\b2\b/.test(text) && !textLite && !textPro;
    return false;
  }

  if (req.includes('veo') || text.includes('veo')) {
    if (!req.includes('veo') || !text.includes('veo')) return false;
    // Flow exposes "Veo 3.1 - Lite" and "Veo 3.1 - Lite [Lower Priority]"
    // as two distinct selectable variants. Never collapse them just because both
    // contain the word "Lite", otherwise the first menu item wins incorrectly.
    if (reqLowerPriority !== textLowerPriority) return false;
    if (reqQuality) return textQuality;
    if (reqFast) return textFast && !textQuality;
    if (reqLite) return textLite && !textQuality;
    return false;
  }

  if (req.includes('omni') || text.includes('omni')) {
    if (text.includes('veo') || text.includes('banana')) return false;
    // A generic composer chip such as "Video · 720p · 8 giây" does not expose
    // the selected model, so it must never be accepted as proof of Omni.
    return text.includes('omni') && req.includes('omni');
  }

  return text.endsWith(` ${req}`) || req.endsWith(` ${text}`);
}

export function composerChipMatchesRequestedModel(chipText: string | undefined, requested: string): boolean {
  return flowModelOptionMatchesRequested(chipText ?? '', requested);
}

/** Content-script Generate is not proof-equivalent to CDP — never use it as a fallback. */
export function shouldFailClosedWhenDebuggerUnavailable(attached: boolean): boolean {
  return !attached;
}

export type ComposerChipScalars = {
  aspectRatio?: string;
  durationSeconds?: number;
  batchCount?: string;
  targetResolution?: string;
};

const CROP_ASPECT: Record<string, string> = {
  crop_16_9: '16:9',
  crop_9_16: '9:16',
  crop_square: '1:1',
  crop_landscape: '4:3',
  crop_portrait: '3:4',
};

/** Parse live Flow composer chip text (and crop_* ligatures) into scalar settings. */
export function parseComposerChipScalars(chipText: string | undefined): ComposerChipScalars {
  const text = (chipText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return {};
  let aspectRatio = text.match(/\b(\d{1,2}:\d{1,2})\b/)?.[1];
  if (!aspectRatio) {
    const crop = text.match(/\bcrop_(16_9|9_16|square|landscape|portrait)\b/i)?.[0]?.toLowerCase();
    if (crop && CROP_ASPECT[crop]) aspectRatio = CROP_ASPECT[crop];
  }
  const durationMatch = text.match(/\b(\d+)s\b/i);
  const batchMatch = text.match(/\bx([1-4])\b/i);
  const resolutionMatch = text.match(/\b(\d{3,4}p)\b/i);
  return {
    aspectRatio,
    durationSeconds: durationMatch ? Number(durationMatch[1]) : undefined,
    batchCount: batchMatch?.[1],
    targetResolution: resolutionMatch?.[1]?.toLowerCase(),
  };
}

export function liveChipProvesRequestedScalar(
  field: CostScalarField,
  requested: unknown,
  live: ComposerChipScalars,
): boolean {
  if (requested === undefined || requested === null || requested === '') return true;
  if (field === 'seed') return false;
  if (field === 'aspectRatio') return live.aspectRatio === String(requested);
  if (field === 'durationSeconds') return live.durationSeconds === Number(requested);
  if (field === 'batchCount') return live.batchCount === String(requested).replace(/^x/i, '');
  if (field === 'targetResolution') return live.targetResolution === String(requested).toLowerCase();
  return false;
}

/** Explicit cost scalars must be live-verified or proven fixed by the model. Seed is never dropped. */
export function canSubmitGenerateWithScalarSettings(args: {
  requested: Partial<Record<CostScalarField, unknown>>;
  verified: Partial<Record<CostScalarField, boolean>>;
  fixedByModel?: Partial<Record<CostScalarField, boolean>>;
}): boolean {
  for (const field of COST_SCALAR_FIELDS) {
    const value = args.requested[field];
    if (value === undefined || value === null || value === '') continue;
    if (field === 'seed') {
      if (!args.verified.seed) return false;
      continue;
    }
    if (args.verified[field] || args.fixedByModel?.[field]) continue;
    return false;
  }
  return true;
}

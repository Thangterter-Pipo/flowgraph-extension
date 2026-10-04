/** Stage policy on top of topological readiness. Does not change GraphPlanner. */

const STAGE_0 = new Set([
  'prompt',
  'gemini',
  'imageInput',
  'uploadImage',
  'mediaInput',
  'videoInput',
  'creationAgent',
  'sceneGroup',
]);

const STAGE_1 = new Set([
  't2i',
  'characterCreate',
  'characterAssign',
  'imageUpscale',
  'imageTransform',
  'storyboardSplit',
]);

const STAGE_2 = new Set([
  'i2v',
  't2v',
  'interpolation',
  'extend',
  'reference',
]);

const STAGE_3 = new Set(['videoUpscale', 'videoConcat']);

const STAGE_4 = new Set(['preview', 'download']);

export function executionStage(kind: string): number {
  if (STAGE_0.has(kind)) return 0;
  if (STAGE_1.has(kind)) return 1;
  if (STAGE_2.has(kind)) return 2;
  if (STAGE_3.has(kind)) return 3;
  if (STAGE_4.has(kind)) return 4;
  return 99;
}

export function selectReadyStage(
  ready: readonly string[],
  byId: ReadonlyMap<string, { kind: string }>,
): string[] {
  if (!ready.length) return [];
  let minStage = Infinity;
  for (const id of ready) {
    const node = byId.get(id);
    if (!node) continue;
    minStage = Math.min(minStage, executionStage(node.kind));
  }
  if (!Number.isFinite(minStage)) return [];
  return ready.filter((id) => {
    const node = byId.get(id);
    return node !== undefined && executionStage(node.kind) === minStage;
  });
}

/**
 * Stage-aware concurrency resolution.
 * - Stage 0 (prompt, gemini, in-memory prep): non-UI, gateway/pure in-memory tasks can run in parallel (up to 8).
 * - Stage 4 (preview, download): client-side UI/download tasks can run in parallel (up to 4).
 * - Stage 1, 2, 3 (Flow generation calls): defaults strictly to provider limit (1) for single-tab UI safety,
 *   with bounded burst allowance when explicit batch transport or draft mode is enabled.
 */
export function resolveEffectiveConcurrencyForStage(
  stage: number,
  requested?: number,
  options?: { allowBurst?: boolean; maxBurst?: number },
): number {
  if (stage === 0) {
    return Math.min(Math.max(requested ?? 4, 1), 8);
  }
  if (stage === 4) {
    return Math.min(Math.max(requested ?? 2, 1), 4);
  }
  if (options?.allowBurst && requested && requested > 1) {
    return Math.min(requested, options.maxBurst ?? 4);
  }
  // Default to standard verified single-tab provider limit (1)
  if (requested === undefined || requested === null || requested < 1) {
    return 1;
  }
  return 1;
}

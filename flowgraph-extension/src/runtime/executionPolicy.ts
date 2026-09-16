/** Stage policy on top of topological readiness. Does not change GraphPlanner. */

const STAGE_0 = new Set([
  'prompt',
  'gemini',
  'imageInput',
  'uploadImage',
  'mediaInput',
  'videoInput',
  'creationAgent',
]);

const STAGE_1 = new Set([
  't2i',
  'characterCreate',
  'characterAssign',
  'imageUpscale',
  'imageTransform',
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

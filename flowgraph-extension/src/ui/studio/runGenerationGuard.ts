/** Guards runtime UI mutations across project switches. Pure — no React. */

export type RunStatusLike = 'ready' | 'running' | 'success' | 'error' | string;

export const PENDING_RUN_ID = '__pending__';

export interface RunGeneration {
  runId: string;
  projectId: string;
}

export function isProjectSelectLocked(runStatus: RunStatusLike | undefined): boolean {
  return runStatus === 'running';
}

/** Config/topology/add/drop/delete while a run is live. Viewport/select stay allowed. */
export function isSemanticMutationLocked(runStatus: RunStatusLike | undefined): boolean {
  return runStatus === 'running';
}

export function isSemanticNodeChange(change: { type: string }): boolean {
  return change.type === 'remove' || change.type === 'add' || change.type === 'replace';
}

export function filterNodeChangesDuringRun<T extends { type: string }>(
  changes: T[],
  runStatus: RunStatusLike | undefined,
): T[] {
  if (!isSemanticMutationLocked(runStatus)) return changes;
  return changes.filter((change) => !isSemanticNodeChange(change));
}

export function filterEdgeChangesDuringRun<T extends { type: string }>(
  changes: T[],
  runStatus: RunStatusLike | undefined,
): T[] {
  if (!isSemanticMutationLocked(runStatus)) return changes;
  return changes.filter((change) => change.type === 'select');
}

export function applyConfigIfUnlocked<T extends { id: string; data: { config: Record<string, string> } }>(
  nodes: T[],
  nodeId: string,
  key: string,
  value: string,
  runStatus: RunStatusLike | undefined,
): T[] {
  if (isSemanticMutationLocked(runStatus)) return nodes;
  return nodes.map((node) => (
    node.id === nodeId
      ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value } } }
      : node
  ));
}

export function belongsToActiveGeneration(
  event: { runId?: string },
  eventProjectId: string | undefined,
  active: RunGeneration | undefined,
): boolean {
  if (!active?.runId || !active.projectId) return false;
  if (!event.runId || event.runId !== active.runId) return false;
  if (!eventProjectId || eventProjectId !== active.projectId) return false;
  return true;
}

/** True while this in-flight run still owns the canvas (epoch + project). */
export function isLiveRun(
  startedEpoch: number,
  liveEpoch: number,
  active: RunGeneration | undefined,
  projectId: string | undefined,
): boolean {
  return startedEpoch === liveEpoch && Boolean(active?.projectId && projectId && active.projectId === projectId);
}

/**
 * Accept a runtime event only if it belongs to the live run/project generation.
 * Pending bind (`PENDING_RUN_ID`) is allowed only while the start epoch is still live.
 */
export function acceptRuntimeEvent(
  event: { runId?: string },
  eventProjectId: string | undefined,
  active: RunGeneration | undefined,
  startedEpoch: number,
  liveEpoch: number,
): boolean {
  if (!isLiveRun(startedEpoch, liveEpoch, active, eventProjectId)) return false;
  if (!event.runId) return false;
  if (active!.runId === PENDING_RUN_ID) return true;
  return belongsToActiveGeneration(event, eventProjectId, active);
}

/** Drop the live generation token as soon as the active project changes. */
export function generationAfterProjectChange(
  previousProjectId: string | undefined,
  nextProjectId: string | undefined,
  active: RunGeneration | undefined,
): RunGeneration | undefined {
  if (!nextProjectId || previousProjectId === nextProjectId) return active;
  return undefined;
}

export function applyNodeEventIfCurrent<T extends { id: string; data: Record<string, unknown> }>(
  nodes: T[],
  event: { runId?: string; nodeId: string; state?: string; result?: unknown },
  eventProjectId: string | undefined,
  active: RunGeneration | undefined,
): T[] {
  if (!belongsToActiveGeneration(event, eventProjectId, active)) return nodes;
  return nodes.map((node) => {
    if (node.id !== event.nodeId) return node;
    return {
      ...node,
      data: {
        ...node.data,
        ...(event.state ? { status: event.state } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
      },
    };
  });
}

// useRunHistory.ts — Run history persistence and workflow save hook.
// Extracted from main.tsx to reduce file size (FG refactor).
// FG-1103: run history is project-scoped, no secrets/signed URLs stored.
import { useCallback, useEffect } from 'react';
import type { RuntimeEvent } from '../../runtime/WorkflowRuntime';
import type { FlowEdge, FlowNode } from './model';
import type { ActiveProjectState } from './useStudioConnection';
import {
  buildSavedWorkflow,
  persistWorkflowIfHydrated,
  resolveHydratedProjectId,
} from './workflowPersistence';

// ─── Run History (FG-1103) ─────────────────────────────────────────────────

const RUN_HISTORY_KEY = 'flowgraph.runHistory.v1';

export function recordRun(
  events: RuntimeEvent[],
  startedAt: string,
  workflowId: string,
  workflowName: string,
  activeProject?: ActiveProjectState,
  forcedStatus?: 'cancelled',
): void {
  if (!activeProject) return;

  const runEvent = [...events]
    .reverse()
    .find((event): event is Extract<RuntimeEvent, { type: 'run' }> => event.type === 'run');

  const observedStatus =
    runEvent?.type === 'run'
      ? runEvent.state === 'validating'
        ? 'failed'
        : runEvent.state
      : 'failed';

  const status =
    forcedStatus === 'cancelled' && runEvent?.state !== 'success' ? 'cancelled' : observedStatus;

  const nodeRuns = events
    .filter(
      (event): event is Extract<RuntimeEvent, { type: 'node' }> =>
        event.type === 'node' && event.state !== 'queued' && event.state !== 'running',
    )
    .map((event) => ({
      nodeId: event.nodeId,
      status:
        event.state === 'success'
          ? ('success' as const)
          : event.state === 'skipped'
            ? ('skipped' as const)
            : ('failed' as const),
      errorCode: event.error?.code,
      errorMessage: event.error?.message,
      diagnosticId: event.error?.diagnosticId,
      creditsUsed: event.creditsUsed,
      result: event.result
        ? {
            type: event.result.type,
            mediaId: event.result.mediaId,
            mimeType: event.result.mimeType,
            fileName: event.result.fileName,
          }
        : undefined,
    }));

  const record = {
    runId: runEvent?.type === 'run' ? runEvent.runId : crypto.randomUUID(),
    workflowId,
    workflowName,
    status:
      status === 'cancelled'
        ? ('cancelled' as const)
        : status === 'success'
          ? ('success' as const)
          : ('failed' as const),
    projectId: activeProject.projectId,
    projectName: activeProject.projectName,
    startedAt,
    finishedAt: new Date().toISOString(),
    nodeRuns,
    creditDelta: 0,
  };

  try {
    const history = JSON.parse(localStorage.getItem(RUN_HISTORY_KEY) ?? '[]') as unknown[];
    history.unshift(record);
    localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  } catch {
    // history is best-effort; never block a run on persistence.
  }
}

// ─── Workflow Persistence Hook (FG-1101/1102) ─────────────────────────────
// Auth material is never saved: only node config + media ids (no signed URLs).

export function useWorkflowPersistence(
  nodes: FlowNode[],
  edges: FlowEdge[],
  workflowId: string,
  workflowName: string,
  projectBinding: { projectId: string; projectName: string } | undefined,
  hydratedProjectId: string | undefined,
  autoSave: boolean,
): { save: () => void; exportJson: () => void } {
  const persistableHydratedId = resolveHydratedProjectId(
    projectBinding?.projectId,
    hydratedProjectId,
  );

  const save = useCallback(() => {
    persistWorkflowIfHydrated(
      nodes,
      edges,
      workflowId,
      workflowName,
      projectBinding,
      persistableHydratedId,
    );
  }, [nodes, edges, workflowId, workflowName, projectBinding, persistableHydratedId]);

  // Auto-persist only after this project's workflow is on canvas + autoSave enabled.
  useEffect(() => {
    if (!autoSave) return;
    persistWorkflowIfHydrated(
      nodes,
      edges,
      workflowId,
      workflowName,
      projectBinding,
      persistableHydratedId,
    );
  }, [autoSave, nodes, edges, workflowId, workflowName, projectBinding, persistableHydratedId]);

  const exportJson = useCallback(() => {
    const payload = buildSavedWorkflow(nodes, edges, workflowId, workflowName, projectBinding);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${workflowName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'flowgraph-workflow'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, workflowId, workflowName, projectBinding]);

  return { save, exportJson };
}

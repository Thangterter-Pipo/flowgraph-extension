import type { NodeSpecForValidation, RuntimePlanEdge } from './GraphValidator';

function stableRecord(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

/** Order-insensitive snapshot of execution-relevant graph identity for retry fencing. */
export function workflowRetrySnapshot(
  nodes: NodeSpecForValidation[],
  edges: RuntimePlanEdge[],
): string {
  const nodePart = [...nodes]
    .map((node) => ({ id: node.id, kind: node.kind, config: stableRecord(node.config) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edgePart = [...edges]
    .map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? '',
      target: edge.target,
      targetHandle: edge.targetHandle ?? '',
    }))
    .sort((a, b) => {
      const left = `${a.source}|${a.sourceHandle}|${a.target}|${a.targetHandle}`;
      const right = `${b.source}|${b.sourceHandle}|${b.target}|${b.targetHandle}`;
      return left.localeCompare(right);
    });
  return JSON.stringify({ nodes: nodePart, edges: edgePart });
}

export function retryGraphChanged(
  snapshot: string,
  nodes: NodeSpecForValidation[],
  edges: RuntimePlanEdge[],
): boolean {
  return workflowRetrySnapshot(nodes, edges) !== snapshot;
}

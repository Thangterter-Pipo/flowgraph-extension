import type { FlowEdge, FlowNode } from './model';
import type { FlowSyncField } from '../../shared/sync/FlowSyncTypes';

export const SEMANTIC_REVERSE_SYNC_FIELDS: readonly FlowSyncField[] = [
  'prompt',
  'mode',
  'model',
  'aspectRatio',
  'batchCount',
  'durationSeconds',
  'seed',
  'targetResolution',
  'startImage',
  'endImage',
  'referenceMedia',
];

export function isSemanticReverseSyncField(field?: string): field is FlowSyncField {
  return (SEMANTIC_REVERSE_SYNC_FIELDS as readonly string[]).includes(field ?? '');
}

/** Semantic Flow→Studio writes must not land while a run token is live. */
export function shouldIgnoreSemanticReverseSync(runActive: boolean, field?: string): boolean {
  return runActive && isSemanticReverseSyncField(field);
}

export function collectDownstreamNodeIds(startIds: Iterable<string>, edges: FlowEdge[]): Set<string> {
  const affected = new Set(startIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of edges) {
      if (affected.has(edge.source) && !affected.has(edge.target)) {
        affected.add(edge.target);
        expanded = true;
      }
    }
  }
  return affected;
}

export function resetRuntimeStateForNodes(nodes: FlowNode[], affected: ReadonlySet<string>): FlowNode[] {
  return nodes.map((node) => {
    if (!affected.has(node.id)) return node;
    return {
      ...node,
      data: {
        ...node.data,
        status: 'idle',
        result: undefined,
        cacheHit: false,
        errorMessage: undefined,
        errorCode: undefined,
        errorRetryable: undefined,
        diagnosticId: undefined,
      },
    };
  });
}

export function reverseSyncWriteNodeId(
  event: { field?: string; nodeId?: string },
  edges: FlowEdge[],
): string | undefined {
  if (!event.nodeId) return undefined;
  if (event.field === 'prompt') {
    const promptEdge = edges.find((edge) => edge.target === event.nodeId && edge.targetHandle === 'prompt');
    return promptEdge?.source ?? event.nodeId;
  }
  return event.nodeId;
}

export function applySemanticReverseSync(
  nodes: FlowNode[],
  edges: FlowEdge[],
  event: { field?: string; nodeId?: string; value?: unknown },
  options: { runActive: boolean; patchConfig: (node: FlowNode, event: { field?: string; value?: unknown }) => FlowNode },
): FlowNode[] {
  if (!event.field || event.field === 'resultMedia' || event.field === 'generationStatus') return nodes;
  if (shouldIgnoreSemanticReverseSync(options.runActive, event.field)) return nodes;
  const writeNodeId = reverseSyncWriteNodeId(event, edges);
  if (!writeNodeId) return nodes;
  const patched = nodes.map((node) => (node.id === writeNodeId ? options.patchConfig(node, event) : node));
  return resetRuntimeStateForNodes(patched, collectDownstreamNodeIds([writeNodeId], edges));
}

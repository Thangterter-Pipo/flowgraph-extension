import { cloneFlowEdges, cloneFlowNodes, type FlowEdge, type FlowNode } from './model';

export const FLOWGRAPH_NODES_CLIP = 'flowgraph/nodes-v1';
export const FLOWGRAPH_MEDIA_CLIP = 'flowgraph/media-v1';
export const FLOWGRAPH_MEDIA_DRAG = 'application/flowgraph-media';

export function isCopyShortcut(event: { key?: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return false;
  return event.key?.toLowerCase() === 'c' || event.code === 'KeyC';
}

export function isCutShortcut(event: { key?: string; code?: string; ctrlKey?: boolean; metaKey?: boolean }): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  return event.key?.toLowerCase() === 'x' || event.code === 'KeyX';
}

export function isPasteShortcut(event: { key?: string; code?: string; ctrlKey?: boolean; metaKey?: boolean }): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  return event.key?.toLowerCase() === 'v' || event.code === 'KeyV';
}

export function copySelectedGraph(nodes: FlowNode[], edges: FlowEdge[]): { type: typeof FLOWGRAPH_NODES_CLIP; nodes: FlowNode[]; edges: FlowEdge[] } | null {
  const selected = nodes.filter((node) => node.selected);
  if (!selected.length) return null;
  const ids = new Set(selected.map((node) => node.id));
  return {
    type: FLOWGRAPH_NODES_CLIP,
    nodes: cloneFlowNodes(selected).map((node) => ({ ...node, selected: false })),
    edges: cloneFlowEdges(edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))),
  };
}

export function cutSelectedGraph(nodes: FlowNode[], edges: FlowEdge[]): {
  clipboard: { type: typeof FLOWGRAPH_NODES_CLIP; nodes: FlowNode[]; edges: FlowEdge[] };
  nodes: FlowNode[];
  edges: FlowEdge[];
} | null {
  const clipboard = copySelectedGraph(nodes, edges);
  if (!clipboard) return null;
  const ids = new Set(clipboard.nodes.map((node) => node.id));
  return {
    clipboard,
    nodes: nodes.filter((node) => !ids.has(node.id)),
    edges: edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
  };
}

export function pasteGraph(payload: { type?: string; nodes?: FlowNode[]; edges?: FlowEdge[] } | null, stamp: string, offset = 48): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  if (!payload || payload.type !== FLOWGRAPH_NODES_CLIP || !payload.nodes?.length) return null;
  const idMap = new Map<string, string>();
  const nodes = cloneFlowNodes(payload.nodes).map((node) => {
    const id = `${stamp}-${node.id}`;
    idMap.set(node.id, id);
    return {
      ...node,
      id,
      selected: true,
      position: { x: node.position.x + offset, y: node.position.y + offset },
    };
  });
  const edges = cloneFlowEdges(payload.edges ?? []).flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) return [];
    return [{ ...edge, id: `${stamp}-${edge.id}`, source, target }];
  });
  return { nodes, edges };
}

export function parseClipboardPayload(raw: string | null | undefined): { type?: string; nodes?: FlowNode[]; edges?: FlowEdge[]; item?: unknown } | null {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as { type?: string };
  } catch {
    return null;
  }
}

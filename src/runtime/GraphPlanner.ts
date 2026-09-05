// Graph planner (FG-0305) — topological sort, cycle detection, ready/downstream resolution.
// Pure logic, no UI dependencies.

export interface PlanNode {
  id: string;
  kind: string;
}

export interface PlanEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
}

export interface CompiledGraph {
  order: string[];          // topological order (empty when a cycle exists)
  cycles: string[][];       // detected cycles (each = list of node ids)
  disconnected: string[];   // nodes with no path from any root
}

export function planGraph(nodes: PlanNode[], edges: PlanEdge[]): CompiledGraph {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of nodeIds) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const queue = [...nodeIds].filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  const remaining = new Map(indegree);
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const value = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, value);
      if (value === 0) queue.push(next);
    }
  }

  if (order.length === nodes.length) {
    return { order, cycles: [], disconnected: findDisconnected(nodes, edges, order) };
  }

  // Kahn's algorithm terminates early when a cycle remains — compute cycle membership.
  const leftover = [...nodeIds].filter((id) => (remaining.get(id) ?? 0) > 0);
  return { order, cycles: leftover.length ? [leftover] : [], disconnected: [] };
}

function findDisconnected(nodes: PlanNode[], edges: PlanEdge[], order: string[]): string[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) incoming.set(id, []);
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incoming.get(edge.target)?.push(edge.source);
  }
  // A node is "rooted" if reachable from a node with indegree 0 or it IS a root.
  const rooted = new Set<string>();
  for (const id of order) {
    const sources = incoming.get(id) ?? [];
    if (sources.length === 0 || sources.some((source) => rooted.has(source))) rooted.add(id);
  }
  return order.filter((id) => !rooted.has(id));
}

/** Nodes whose required inputs are all satisfied and that haven't run yet. */
export function readyNodes(
  order: string[],
  edges: PlanEdge[],
  completed: ReadonlySet<string>,
  failed: ReadonlySet<string>,
): string[] {
  const nodeIds = new Set(order);
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of nodeIds) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  for (const id of completed) {
    for (const next of outgoing.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
    }
  }
  return [...nodeIds].filter((id) => !completed.has(id) && !failed.has(id) && (indegree.get(id) ?? 0) === 0);
}

/** Nodes reachable downstream from `from` (transitive). */
export function downstreamOf(from: string, edges: PlanEdge[]): string[] {
  const nodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const outgoing = new Map<string, string[]>();
  for (const id of nodeIds) outgoing.set(id, []);
  for (const edge of edges) outgoing.get(edge.source)?.push(edge.target);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const current = stack.pop()!;
    for (const next of outgoing.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return [...seen];
}

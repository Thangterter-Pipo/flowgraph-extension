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
  order: string[];          // topological order of the execution scope (empty when a cycle exists)
  cycles: string[][];       // detected cycles (each = list of node ids)
  disconnected: string[];   // nodes excluded from execution scope
}

const OUTPUT_SINK_KINDS = new Set(['download', 'preview']);

export function executionScope(nodes: PlanNode[], edges: PlanEdge[]): Set<string> {
  const sinks = nodes.filter((node) => OUTPUT_SINK_KINDS.has(node.kind)).map((node) => node.id);
  if (!sinks.length) return new Set(nodes.map((node) => node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) incoming.set(id, []);
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incoming.get(edge.target)?.push(edge.source);
  }
  const scope = new Set<string>();
  const stack = [...sinks];
  while (stack.length) {
    const id = stack.pop()!;
    if (scope.has(id)) continue;
    scope.add(id);
    for (const source of incoming.get(id) ?? []) stack.push(source);
  }
  return scope;
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
    const scope = executionScope(nodes, edges);
    const disconnected = nodes.map((node) => node.id).filter((id) => !scope.has(id));
    const scopedOrder = disconnected.length ? order.filter((id) => scope.has(id)) : order;
    return { order: scopedOrder, cycles: [], disconnected };
  }

  // Kahn's algorithm terminates early when a cycle remains — compute cycle membership.
  const leftover = [...nodeIds].filter((id) => (remaining.get(id) ?? 0) > 0);
  return { order, cycles: leftover.length ? [leftover] : [], disconnected: [] };
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

import { FlowEdge, FlowNode } from './model';

/**
 * Thuật toán Tự Động Bố Trí Đồ Thị Phân Tầng (Hierarchical Layered Auto-Layout)
 * Tự động tính toán cấp độ phân cấp (ranks/layers) dựa trên hướng dây nối (DAG)
 * và sắp xếp các node thẳng hàng từ trái sang phải với khoảng cách cân xứng, mượt mà!
 */
export function calculateAutoLayout(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  if (nodes.length === 0) return nodes;

  // 1. Tính toán bậc vào (in-degree) và danh sách kề (adjacency)
  const inDegree: Record<string, number> = {};
  const outgoing: Record<string, string[]> = {};
  const incoming: Record<string, string[]> = {};

  for (const node of nodes) {
    inDegree[node.id] = 0;
    outgoing[node.id] = [];
    incoming[node.id] = [];
  }

  for (const edge of edges) {
    if (inDegree[edge.target] !== undefined && outgoing[edge.source] !== undefined) {
      inDegree[edge.target]++;
      outgoing[edge.source].push(edge.target);
      incoming[edge.target].push(edge.source);
    }
  }

  // 2. Phân tầng theo Topological Sort (Kahn's algorithm)
  const ranks: Record<string, number> = {};
  const queue: string[] = [];

  for (const node of nodes) {
    if (inDegree[node.id] === 0) {
      ranks[node.id] = 0;
      queue.push(node.id);
    }
  }

  // Nếu có chu trình hoặc đồ thị cô lập, khởi tạo rank 0 cho tất cả
  if (queue.length === 0) {
    for (const node of nodes) {
      ranks[node.id] = 0;
      queue.push(node.id);
    }
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const currRank = ranks[currId] ?? 0;

    for (const nextId of outgoing[currId] || []) {
      const nextRank = Math.max(ranks[nextId] ?? 0, currRank + 1);
      ranks[nextId] = nextRank;
      inDegree[nextId]--;
      if (inDegree[nextId] === 0) {
        queue.push(nextId);
      }
    }
  }

  // Với bất kỳ node nào còn sót lại chưa có rank
  for (const node of nodes) {
    if (ranks[node.id] === undefined) {
      ranks[node.id] = 0;
    }
  }

  // 3. Gom nhóm các node theo từng tầng (Column / Rank)
  const rankGroups: Record<number, FlowNode[]> = {};
  for (const node of nodes) {
    const r = ranks[node.id];
    if (!rankGroups[r]) rankGroups[r] = [];
    rankGroups[r].push(node);
  }

  // 4. Sắp xếp vị trí tọa độ (X, Y)
  // Media-first nodes keep labels/handles/tools outside the visual surface.
  // Reserve enough air between columns/rows so those external controls never
  // collide after Auto Layout.
  const HORIZONTAL_GAP = 640;
  const VERTICAL_GAP = 380;
  const START_X = 80;
  const START_Y = 80;

  const updatedNodes: FlowNode[] = [];
  const sortedRanks = Object.keys(rankGroups).map(Number).sort((a, b) => a - b);

  for (const r of sortedRanks) {
    const group = rankGroups[r];
    // Sắp xếp thứ tự trong cùng 1 cột dựa trên vị trí Y ban đầu để hạn chế bắt chéo dây
    group.sort((a, b) => (a.position.y || 0) - (b.position.y || 0));

    // Căn giữa theo chiều dọc nếu số lượng node ở các cột khác nhau
    const maxGroupLen = Math.max(...Object.values(rankGroups).map((g) => g.length));
    const offsetCount = (maxGroupLen - group.length) / 2;
    const startYForCol = START_Y + offsetCount * VERTICAL_GAP;

    group.forEach((node, idx) => {
      const newX = START_X + r * HORIZONTAL_GAP;
      const newY = startYForCol + idx * VERTICAL_GAP;

      updatedNodes.push({
        ...node,
        position: { x: newX, y: newY },
      });
    });
  }

  return updatedNodes;
}

import { planGraph } from '../../runtime/GraphPlanner';
import type { RuntimeValue } from '../../runtime/RuntimeValue';
import type { FlowEdge, FlowNode } from './model';
import { portsForKind } from './ports';

export type WorkflowRunMode = 'restart' | 'continue';

export interface RunReceipt {
  signature: string;
  outputs: Record<string, RuntimeValue>;
}

export function createRunReceipt(signature: string, outputs: Record<string, RuntimeValue>): RunReceipt {
  const safeOutputs = JSON.parse(JSON.stringify(outputs, (key, value) =>
    ['previewUrl', 'signedPreviewUrl', 'transientUrl', 'url', 'downloadUrl', 'uri'].includes(key) ? undefined : value,
  )) as Record<string, RuntimeValue>;
  return { signature, outputs: safeOutputs };
}

// URL refreshes and canvas presentation are not execution changes. Edge order is
// retained: multi-input executors (notably concat) consume that order.
export function runNodeSignatures(nodes: FlowNode[], edges: FlowEdge[], projectId: string): Map<string, string> {
  return new Map(nodes.map((node) => [node.id, JSON.stringify({
    projectId,
    kind: node.data.kind,
    config: Object.fromEntries(Object.entries(node.data.config)
      .filter(([key]) => !['signedPreviewUrl', 'transientUrl'].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))),
    incoming: edges.filter((edge) => edge.target === node.id).map((edge) => [
      edge.source, edge.sourceHandle ?? '', edge.targetHandle ?? '',
    ]),
  })]));
}

function validValue(value: RuntimeValue | undefined, projectId: string): boolean {
  if (!value || value.value === null || value.value === undefined) return false;
  if (['image', 'video', 'media'].includes(value.type)) {
    const media = value.value as Record<string, unknown>;
    return media.provider === 'GOOGLE_FLOW' && media.projectId === projectId
      && typeof media.mediaId === 'string' && Boolean(media.mediaId.trim())
      && !/^(?:local-|dropped-|local-vid-|stitched-|concat-|stitch-idb:)/i.test(media.mediaId.trim())
      && (value.type === 'image' ? media.type === 'IMAGE'
        : value.type === 'video' ? media.type === 'VIDEO'
        : media.type === 'IMAGE' || media.type === 'VIDEO');
  }
  if (['text', 'file'].includes(value.type)) return typeof value.value === 'string' && Boolean(value.value.trim());
  if (value.type === 'number') return typeof value.value === 'number' && Number.isFinite(value.value);
  if (value.type === 'boolean') return typeof value.value === 'boolean';
  return ['character', 'json'].includes(value.type) && typeof value.value === 'object';
}

function validOutputs(node: FlowNode, outputs: Record<string, RuntimeValue>, projectId: string): boolean {
  return portsForKind(node.data.kind).outputs.every((port) => {
    if (port.required === false && !outputs[port.id]) return true;
    const value = outputs[port.id];
    if (!validValue(value, projectId)) return false;
    const expected = port.type.toLowerCase();
    return expected === 'any' || (expected === 'prompt' ? value.type === 'text'
      : expected === 'media' ? ['media', 'image', 'video'].includes(value.type)
      : expected === 'character_list' ? value.type === 'json' : value.type === expected);
  });
}

/** Planning never mutates the canvas or the project cache. */
export function buildRunModePlan(mode: WorkflowRunMode, nodes: FlowNode[], edges: FlowEdge[], projectId: string) {
  const graph = planGraph(nodes.map((node) => ({ id: node.id, kind: node.data.kind })), edges.map((edge) => ({
    ...edge, sourceHandle: edge.sourceHandle ?? undefined, targetHandle: edge.targetHandle ?? undefined,
  })));
  const signatures = runNodeSignatures(nodes, edges, projectId);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const run: string[] = [];
  const reuse: string[] = [];
  const initialOutputs = new Map<string, Record<string, RuntimeValue>>();
  const initialCompleted = new Set<string>();
  const blocked = graph.cycles.flat();
  let blockReason = blocked.length ? 'Quy trình có vòng lặp; hãy sửa kết nối trước khi chạy.' : undefined;
  if (!blocked.length) for (const id of graph.order) {
    const node = byId.get(id)!;
    const receipt = node.data.runReceipt as RunReceipt | undefined;
    if (mode === 'continue' && ((node.data.status === 'success' && !receipt)
      || edges.some((edge) => edge.target === id && blocked.includes(edge.source)))) {
      blocked.push(id);
      blockReason = 'Không thể Tiếp tục chạy: bước đã thành công thiếu run receipt để xác minh đầu ra. Chọn Chạy lại từ đầu (Restart) và xác nhận tiêu tốn credit để tạo lại; các bước phụ thuộc cũng bị chặn.';
      continue;
    }
    const upstreamValid = edges.filter((edge) => edge.target === id).every((edge) => initialCompleted.has(edge.source));
    if (mode === 'continue' && node.data.status === 'success' && upstreamValid
      && receipt && receipt.signature === signatures.get(id) && receipt.outputs
      && validOutputs(node, receipt.outputs, projectId)) {
      reuse.push(id);
      initialCompleted.add(id);
      initialOutputs.set(id, receipt.outputs);
    } else run.push(id);
  }
  return { mode, projectId, run, reuse, blocked, blockReason, initialOutputs, initialCompleted,
    // Reopened failures/changes must not silently replay the old project cache.
    bypassCacheNodeIds: new Set(run), signatures };
}

// RuntimeApi: bề mặt DUY NHẤT mà Agent (ReAct loop) và MCP handler được gọi vào.
// - Không import chrome.*, không import runtime/ hay agent/ (shared không phụ thuộc ai).
// - Mọi giá trị vào/ra đều JSON-serializable => đi qua postMessage / MCP được nguyên vẹn.
// - Lỗi nghiệp vụ trả về dạng ApiResult (có mã cố định), không ném exception.
// - KHÔNG có grant()/reject(): quyền duyệt credit chỉ thuộc Approval Card của người dùng.

import type {
  ApprovalDecision,
  ApprovalErrorCode,
  ApprovalProposal,
  RenderPlan,
} from './approval-types';

/* ───────────── Đồ thị ───────────── */

export type NodeKind = 'prompt' | 't2i' | 'i2v' | 't2v' | 'videoConcat' | 'preview' | 'download';
export type EdgeKind = 'PROMPT' | 'IMAGE' | 'VIDEO';

export interface NodeParams {
  prompt?: string;
  durationSec?: number; // node video: tối đa MAX_VIDEO_SECONDS
  model?: string;
  imageArtifactId?: string; // dạng 'stitch-idb:...', KHÔNG phải URL CDN tạm
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label?: string;
  params: NodeParams;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
}

export interface GraphSnapshot {
  /** Tăng sau mỗi thay đổi đồ thị. Dùng cho optimistic concurrency. */
  revision: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MutationOpts {
  /** Nếu truyền và khác revision hiện tại (người dùng vừa sửa canvas) => REVISION_CONFLICT. */
  expectedRevision?: number;
}

export interface CreateNodeInput {
  kind: NodeKind;
  label?: string;
  params?: NodeParams;
}

export interface UpdateNodePatch {
  label?: string;
  /** Gộp vào params hiện có; trường không truyền thì giữ nguyên. */
  params?: NodeParams;
}

export interface ConnectEdgeInput {
  kind: EdgeKind;
  source: string;
  target: string;
}

/* ───────────── Render ───────────── */

export interface SubmitRenderInput {
  plan: RenderPlan;
  approvalToken?: string;
}

export type SceneStatus = 'queued' | 'rendering' | 'done' | 'failed';

export interface SceneRenderState {
  sceneId: string;
  status: SceneStatus;
  mediaId?: string; // data-media-id đã đối chiếu (Exact Attribution)
  artifactId?: string; // 'stitch-idb:...' khi đã lưu cục bộ
  error?: { code: string; message: string };
}

export interface RenderStatus {
  batchId: string;
  credits: number;
  /** running: còn cảnh chờ/đang render. done: tất cả xong. failed: hết việc nhưng có cảnh lỗi. */
  state: 'running' | 'done' | 'failed';
  scenes: SceneRenderState[];
}

/* ───────────── Chẩn đoán & dữ liệu ───────────── */

export interface ArtifactInfo {
  artifactId: string; // luôn là 'stitch-idb:...'
  kind: 'video' | 'image';
  sceneId?: string;
  durationSec?: number;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface CdpLogEntry {
  ts: number;
  level: LogLevel;
  source: 'cdp' | 'flow' | 'runtime';
  code?: string; // vd: 'CAPTCHA_BLOCKED'
  message: string;
}

export interface ReadLogOpts {
  limit?: number; // mặc định 50, lấy các dòng mới nhất
  minLevel?: LogLevel;
}

export interface FlowTabStatus {
  attached: boolean; // Chrome Debugger đã gắn vào tab Flow chưa
  url?: string;
  loggedIn: boolean;
  captcha: boolean;
}

export interface CreditBalance {
  /** null = chưa đọc được từ Flow. Không được bịa số. */
  creditsRemaining: number | null;
}

/* ───────────── Kết quả & lỗi ───────────── */

export type ApiErrorCode =
  | ApprovalErrorCode
  | 'NODE_NOT_FOUND'
  | 'EDGE_NOT_FOUND'
  | 'BATCH_NOT_FOUND'
  | 'INVALID_EDGE'
  | 'CYCLE_DETECTED'
  | 'INVARIANT_VIOLATION'
  | 'REVISION_CONFLICT'
  | 'INSUFFICIENT_CREDITS'
  | 'FLOW_UNAVAILABLE'
  | 'CAPTCHA_BLOCKED'
  | 'INTERNAL';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });
export const fail = (code: ApiErrorCode, message: string): ApiResult<never> => ({
  ok: false,
  error: { code, message },
});

/* ───────────── RuntimeApi ───────────── */

export interface RuntimeApi {
  // Đọc (không tốn credit, không cần xác nhận)
  readGraph(): Promise<ApiResult<GraphSnapshot>>;
  getCreditBalance(): Promise<ApiResult<CreditBalance>>;
  getRenderStatus(batchId: string): Promise<ApiResult<RenderStatus>>;
  listArtifacts(): Promise<ApiResult<ArtifactInfo[]>>;
  readCdpLog(opts?: ReadLogOpts): Promise<ApiResult<CdpLogEntry[]>>;
  checkFlowTab(): Promise<ApiResult<FlowTabStatus>>;

  // Sửa đồ thị (xác nhận với người dùng khi sửa/xóa nằm ở agent/guardrails/confirm-mutation)
  createNode(input: CreateNodeInput, opts?: MutationOpts): Promise<ApiResult<{ node: GraphNode; revision: number }>>;
  updateNode(nodeId: string, patch: UpdateNodePatch, opts?: MutationOpts): Promise<ApiResult<{ node: GraphNode; revision: number }>>;
  deleteNode(nodeId: string, opts?: MutationOpts): Promise<ApiResult<{ removedEdgeIds: string[]; revision: number }>>;
  connectEdge(input: ConnectEdgeInput, opts?: MutationOpts): Promise<ApiResult<{ edge: GraphEdge; revision: number }>>;
  disconnectEdge(edgeId: string, opts?: MutationOpts): Promise<ApiResult<{ revision: number }>>;

  // Render (tốn credit): propose -> (người dùng bấm Duyệt) -> awaitApproval -> submit
  proposeRender(plan: RenderPlan): Promise<ApiResult<ApprovalProposal>>;
  awaitApproval(proposalId: string, timeoutMs?: number): Promise<ApiResult<ApprovalDecision>>;
  submitRender(input: SubmitRenderInput): Promise<ApiResult<{ batchId: string; credits: number }>>;
}

/**
 * Danh sách method được phép đi qua MCP / postMessage. Dùng làm whitelist ở handler
 * thay vì cho phép gọi theo tên tùy ý. Cố ý không có grant/reject.
 */
export const RUNTIME_API_METHODS = [
  'readGraph',
  'getCreditBalance',
  'getRenderStatus',
  'listArtifacts',
  'readCdpLog',
  'checkFlowTab',
  'createNode',
  'updateNode',
  'deleteNode',
  'connectEdge',
  'disconnectEdge',
  'proposeRender',
  'awaitApproval',
  'submitRender',
] as const satisfies readonly (keyof RuntimeApi)[];

export type RuntimeApiMethod = (typeof RUNTIME_API_METHODS)[number];

// MockRuntime: triển khai RuntimeApi trong bộ nhớ để test Agent loop và chạy eval
// mà KHÔNG mở Google Flow, KHÔNG tốn credit.
//
// - Dùng ApprovalGate THẬT: token một lần, hết hạn, ràng buộc hash hoạt động y như production.
// - Luật đồ thị và bất biến lấy từ shared/graph-rules.ts (cùng nguồn với runtime thật).
// - `mock.user` mô phỏng người dùng bấm Approval Card. RuntimeApi (thứ agent thấy) không có grant().

import { ApprovalGate } from '../../src/runtime/approval/ApprovalGate';
import { ApprovalError } from '../../src/runtime/approval/types';
import type { ApprovalToken, RenderPlan } from '../../src/shared/approval-types';
import type {
  ApiError,
  ApiErrorCode,
  ApiResult,
  ArtifactInfo,
  CdpLogEntry,
  ConnectEdgeInput,
  CreateNodeInput,
  CreditBalance,
  FlowTabStatus,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  LogLevel,
  MutationOpts,
  ReadLogOpts,
  RenderStatus,
  RuntimeApi,
  SceneRenderState,
  SubmitRenderInput,
  UpdateNodePatch,
} from '../../src/shared/bridge-types';
import { fail, ok } from '../../src/shared/bridge-types';
import { canConnect, checkNodeParams, checkPlanInvariants } from '../../src/shared/graph-rules';

export type ApprovalPolicy = 'manual' | 'auto-approve' | 'auto-reject';

export interface MockRuntimeOptions {
  /** Số credit còn lại. null = chưa đọc được. Mặc định 1000. */
  creditBalance?: number | null;
  /** Giá mỗi cảnh theo model. Model không có trong bảng dùng 20. */
  creditPerScene?: Record<string, number>;
  /** Mô phỏng người dùng ở Approval Card khi agent gọi awaitApproval. Mặc định 'manual'. */
  approval?: ApprovalPolicy;
  /** true: render xong ngay khi submit. false: để 'rendering' cho tới khi gọi completeScene/completeAll. */
  autoCompleteRender?: boolean;
  /** Cảnh nào sẽ thất bại khi render, kèm mã lỗi để agent đọc log. */
  failScenes?: Record<string, { code: string; message: string }>;
  flow?: Partial<FlowTabStatus>;
  initialGraph?: { nodes: GraphNode[]; edges: GraphEdge[] };
  now?: () => number;
}

export interface CallRecord {
  method: string;
  args: unknown;
  ok: boolean;
  errorCode?: ApiErrorCode;
}

interface MockBatch {
  id: string;
  credits: number;
  plan: RenderPlan;
  scenes: SceneRenderState[];
}

const DEFAULT_PRICE = 20;
const LEVEL_RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };
const clone = <T>(v: T): T => structuredClone(v);

export class MockRuntime implements RuntimeApi {
  /** Mọi lời gọi RuntimeApi, theo thứ tự. Eval dùng để assert hành vi của agent. */
  readonly calls: CallRecord[] = [];
  /** Các batch đã thật sự "gửi lên Flow". Rỗng = chưa render gì, chưa tốn credit. */
  readonly submissions: Array<{ batchId: string; credits: number; sceneIds: string[] }> = [];
  /** Mô phỏng Approval Card. Không thuộc RuntimeApi nên agent không với tới được. */
  readonly user: { approve(proposalId: string): ApprovalToken; reject(proposalId: string): void };

  private readonly gate: ApprovalGate;
  private readonly now: () => number;
  private readonly prices: Record<string, number>;
  private readonly failScenes: Record<string, { code: string; message: string }>;
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly batches = new Map<string, MockBatch>();
  private readonly artifacts: ArtifactInfo[] = [];
  private readonly logs: CdpLogEntry[] = [];
  private flow: FlowTabStatus;
  private balance: number | null;
  private policy: ApprovalPolicy;
  private autoComplete: boolean;
  private revision = 0;
  private nodeSeq = 0;
  private edgeSeq = 0;
  private spent = 0;

  constructor(opts: MockRuntimeOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.balance = opts.creditBalance === undefined ? 1000 : opts.creditBalance;
    this.prices = { ...(opts.creditPerScene ?? {}) };
    this.failScenes = { ...(opts.failScenes ?? {}) };
    this.policy = opts.approval ?? 'manual';
    this.autoComplete = opts.autoCompleteRender ?? true;
    this.flow = { attached: true, url: 'https://flow.google.com/', loggedIn: true, captcha: false, ...opts.flow };

    this.gate = new ApprovalGate({ estimator: { estimate: (p) => this.estimate(p) }, now: this.now });
    this.user = {
      approve: (id) => this.gate.grant(id),
      reject: (id) => this.gate.reject(id),
    };

    for (const n of opts.initialGraph?.nodes ?? []) this.nodes.set(n.id, clone(n));
    for (const e of opts.initialGraph?.edges ?? []) this.edges.set(e.id, clone(e));
  }

  /* ───────── Điều khiển kịch bản test (agent không thấy) ───────── */

  get creditsSpent(): number { return this.spent; }
  get creditsRemaining(): number | null { return this.balance; }
  setPrice(model: string, perScene: number): void { this.prices[model] = perScene; }
  setFlow(patch: Partial<FlowTabStatus>): void { this.flow = { ...this.flow, ...patch }; }
  setApprovalPolicy(p: ApprovalPolicy): void { this.policy = p; }
  setAutoComplete(v: boolean): void { this.autoComplete = v; }
  injectLog(level: LogLevel, source: CdpLogEntry['source'], message: string, code?: string): void {
    this.logs.push({ ts: this.now(), level, source, message, ...(code ? { code } : {}) });
  }

  completeScene(batchId: string, sceneId: string): void {
    const batch = this.batches.get(batchId);
    if (batch) this.settleScene(batch, sceneId);
  }

  completeAll(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (batch) for (const s of batch.scenes) this.settleScene(batch, s.sceneId);
  }

  /* ───────── Đọc ───────── */

  readGraph(): Promise<ApiResult<GraphSnapshot>> {
    return this.call('readGraph', undefined, () => ok(this.snapshot()));
  }

  getCreditBalance(): Promise<ApiResult<CreditBalance>> {
    return this.call('getCreditBalance', undefined, () => ok({ creditsRemaining: this.balance }));
  }

  getRenderStatus(batchId: string): Promise<ApiResult<RenderStatus>> {
    return this.call('getRenderStatus', { batchId }, () => {
      const b = this.batches.get(batchId);
      if (!b) return fail('BATCH_NOT_FOUND', `Không có batch ${batchId}.`);
      const pending = b.scenes.some((s) => s.status === 'queued' || s.status === 'rendering');
      const anyFailed = b.scenes.some((s) => s.status === 'failed');
      const state = pending ? 'running' : anyFailed ? 'failed' : 'done';
      return ok(clone({ batchId: b.id, credits: b.credits, state, scenes: b.scenes } as RenderStatus));
    });
  }

  listArtifacts(): Promise<ApiResult<ArtifactInfo[]>> {
    return this.call('listArtifacts', undefined, () => ok(clone(this.artifacts)));
  }

  readCdpLog(opts: ReadLogOpts = {}): Promise<ApiResult<CdpLogEntry[]>> {
    return this.call('readCdpLog', opts, () => {
      const min = LEVEL_RANK[opts.minLevel ?? 'info'];
      const rows = this.logs.filter((l) => LEVEL_RANK[l.level] >= min);
      return ok(clone(rows.slice(-(opts.limit ?? 50))));
    });
  }

  checkFlowTab(): Promise<ApiResult<FlowTabStatus>> {
    return this.call('checkFlowTab', undefined, () => ok(clone(this.flow)));
  }

  /* ───────── Sửa đồ thị ───────── */

  createNode(input: CreateNodeInput, opts?: MutationOpts) {
    return this.call('createNode', { input, opts }, () => {
      const conflict = this.checkRevision(opts);
      if (conflict) return conflict;
      const params = { ...(input.params ?? {}) };
      const bad = checkNodeParams(input.kind, params);
      if (bad) return { ok: false as const, error: bad };
      const node: GraphNode = { id: `node-${++this.nodeSeq}`, kind: input.kind, params, ...(input.label ? { label: input.label } : {}) };
      this.nodes.set(node.id, node);
      return ok({ node: clone(node), revision: ++this.revision });
    });
  }

  updateNode(nodeId: string, patch: UpdateNodePatch, opts?: MutationOpts) {
    return this.call('updateNode', { nodeId, patch, opts }, () => {
      const conflict = this.checkRevision(opts);
      if (conflict) return conflict;
      const node = this.nodes.get(nodeId);
      if (!node) return fail('NODE_NOT_FOUND', `Không có node ${nodeId}.`);
      const params = { ...node.params, ...(patch.params ?? {}) };
      const bad = checkNodeParams(node.kind, params);
      if (bad) return { ok: false as const, error: bad };
      node.params = params;
      if (patch.label !== undefined) node.label = patch.label;
      return ok({ node: clone(node), revision: ++this.revision });
    });
  }

  deleteNode(nodeId: string, opts?: MutationOpts) {
    return this.call('deleteNode', { nodeId, opts }, () => {
      const conflict = this.checkRevision(opts);
      if (conflict) return conflict;
      if (!this.nodes.delete(nodeId)) return fail('NODE_NOT_FOUND', `Không có node ${nodeId}.`);
      const removedEdgeIds: string[] = [];
      for (const [id, e] of this.edges) {
        if (e.source === nodeId || e.target === nodeId) {
          this.edges.delete(id);
          removedEdgeIds.push(id);
        }
      }
      return ok({ removedEdgeIds, revision: ++this.revision });
    });
  }

  connectEdge(input: ConnectEdgeInput, opts?: MutationOpts) {
    return this.call('connectEdge', { input, opts }, () => {
      const conflict = this.checkRevision(opts);
      if (conflict) return conflict;
      const src = this.nodes.get(input.source);
      const dst = this.nodes.get(input.target);
      if (!src) return fail('NODE_NOT_FOUND', `Không có node nguồn ${input.source}.`);
      if (!dst) return fail('NODE_NOT_FOUND', `Không có node đích ${input.target}.`);
      if (!canConnect(src.kind, input.kind, dst.kind)) {
        return fail('INVALID_EDGE', `Không nối được ${src.kind} -[${input.kind}]-> ${dst.kind}.`);
      }
      const dup = [...this.edges.values()].some(
        (e) => e.source === input.source && e.target === input.target && e.kind === input.kind,
      );
      if (dup) return fail('INVALID_EDGE', 'Dây nối này đã tồn tại.');
      if (input.source === input.target || this.reaches(input.target, input.source)) {
        return fail('CYCLE_DETECTED', 'Dây nối này tạo chu trình trong đồ thị.');
      }
      const edge: GraphEdge = { id: `edge-${++this.edgeSeq}`, kind: input.kind, source: input.source, target: input.target };
      this.edges.set(edge.id, edge);
      return ok({ edge: clone(edge), revision: ++this.revision });
    });
  }

  disconnectEdge(edgeId: string, opts?: MutationOpts) {
    return this.call('disconnectEdge', { edgeId, opts }, () => {
      const conflict = this.checkRevision(opts);
      if (conflict) return conflict;
      if (!this.edges.delete(edgeId)) return fail('EDGE_NOT_FOUND', `Không có dây nối ${edgeId}.`);
      return ok({ revision: ++this.revision });
    });
  }

  /* ───────── Render ───────── */

  proposeRender(plan: RenderPlan) {
    return this.call('proposeRender', plan, async () => {
      const blocked = this.preflight(plan);
      if (blocked) return { ok: false as const, error: blocked };
      return ok(await this.gate.propose(plan));
    });
  }

  awaitApproval(proposalId: string, timeoutMs?: number) {
    return this.call('awaitApproval', { proposalId, timeoutMs }, async () => {
      // Mô phỏng người dùng ở Approval Card theo policy của kịch bản test
      if (this.policy === 'auto-approve') this.tryUser(() => this.gate.grant(proposalId));
      if (this.policy === 'auto-reject') this.tryUser(() => this.gate.reject(proposalId));
      return ok(await this.gate.awaitDecision(proposalId, timeoutMs));
    });
  }

  submitRender(input: SubmitRenderInput) {
    return this.call('submitRender', input, async () => {
      // Preflight TRƯỚC redeem: Flow đang kẹt captcha thì không đốt token vô ích.
      const blocked = this.preflight(input.plan);
      if (blocked) return { ok: false as const, error: blocked };

      const batch = await this.gate.redeem(input.plan, input.approvalToken); // ném ApprovalError nếu sai
      const { credits, proposalId: batchId } = batch.receipt;

      if (this.balance !== null) this.balance -= credits;
      this.spent += credits;
      const mb: MockBatch = {
        id: batchId,
        credits,
        plan: batch.plan,
        scenes: batch.plan.scenes.map((s): SceneRenderState => ({ sceneId: s.sceneId, status: this.autoComplete ? 'queued' : 'rendering' })),
      };
      this.batches.set(batchId, mb);
      this.submissions.push({ batchId, credits, sceneIds: [...batch.receipt.sceneIds] });
      if (this.autoComplete) for (const s of mb.scenes) this.settleScene(mb, s.sceneId);
      return ok({ batchId, credits });
    });
  }

  /* ───────── Nội bộ ───────── */

  private async call<T>(method: string, args: unknown, fn: () => ApiResult<T> | Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    let result: ApiResult<T>;
    try {
      result = await fn();
    } catch (e) {
      result = toFailure(e);
    }
    this.calls.push({ method, args: clone(args ?? null), ok: result.ok, ...(result.ok ? {} : { errorCode: result.error.code }) });
    return result;
  }

  private estimate(plan: RenderPlan): number {
    return (plan.scenes?.length ?? 0) * (this.prices[plan.model] ?? DEFAULT_PRICE);
  }

  private preflight(plan: RenderPlan): ApiError | null {
    const inv = checkPlanInvariants(plan);
    if (inv) return inv;
    if (!this.flow.attached) return { code: 'FLOW_UNAVAILABLE', message: 'Chưa gắn debugger vào tab Google Flow.' };
    if (this.flow.captcha) return { code: 'CAPTCHA_BLOCKED', message: 'Google Flow đang yêu cầu captcha. Cần người dùng giải tay.' };
    const cost = this.estimate(plan);
    if (this.balance !== null && cost > this.balance) {
      return { code: 'INSUFFICIENT_CREDITS', message: `Cần ${cost} credit nhưng chỉ còn ${this.balance}.` };
    }
    return null;
  }

  private settleScene(batch: MockBatch, sceneId: string): void {
    const s = batch.scenes.find((x) => x.sceneId === sceneId);
    const spec = batch.plan.scenes.find((x) => x.sceneId === sceneId);
    if (!s || !spec || s.status === 'done' || s.status === 'failed') return;

    const injected = this.failScenes[sceneId];
    if (injected) {
      s.status = 'failed';
      s.error = { ...injected };
      this.injectLog('error', 'flow', `Cảnh ${sceneId} thất bại: ${injected.message}`, injected.code);
      return;
    }
    const tag = `${batch.id.slice(0, 8)}-${sceneId}`;
    s.status = 'done';
    s.mediaId = `media-${tag}`;
    s.artifactId = `stitch-idb:mock-${tag}`;
    this.artifacts.push({
      artifactId: s.artifactId,
      kind: spec.nodeType === 't2i' ? 'image' : 'video',
      sceneId,
      ...(spec.nodeType === 't2i' ? {} : { durationSec: spec.durationSec }),
    });
  }

  private checkRevision(opts?: MutationOpts): ApiResult<never> | null {
    if (opts?.expectedRevision !== undefined && opts.expectedRevision !== this.revision) {
      return fail('REVISION_CONFLICT', `Đồ thị đã đổi (revision ${this.revision}, bạn dùng ${opts.expectedRevision}). Đọc lại bằng readGraph.`);
    }
    return null;
  }

  /** Có đường đi from -> ... -> to trong đồ thị hiện tại không. */
  private reaches(from: string, to: string): boolean {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of this.edges.values()) if (e.source === cur) stack.push(e.target);
    }
    return false;
  }

  private snapshot(): GraphSnapshot {
    return clone({ revision: this.revision, nodes: [...this.nodes.values()], edges: [...this.edges.values()] });
  }

  private tryUser(fn: () => unknown): void {
    try { fn(); } catch { /* đã quyết định trước đó hoặc hết hạn: để gate tự báo qua awaitDecision */ }
  }
}

function toFailure(e: unknown): ApiResult<never> {
  if (e instanceof ApprovalError) return fail(e.code, e.message);
  return fail('INTERNAL', e instanceof Error ? e.message : String(e));
}

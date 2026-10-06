import { computePlanHash, normalizePlan, toHex } from './plan-hash';
import { ApprovalError } from './types';
import type {
  ApprovalDecision,
  ApprovalProposal,
  ApprovalToken,
  ApprovedBatch,
  CreditEstimator,
  RenderPlan,
} from './types';

export const APPROVAL_TTL_MS = 5 * 60 * 1000;

interface ProposalRecord {
  proposalId: string;
  planHash: string;
  credits: number;
  model: string;
  sceneCount: number;
  proposedAt: number;
  expiresAt: number;
  status: 'pending' | 'granted' | 'rejected';
  token?: ApprovalToken;
}

interface TokenRecord {
  proposalId: string;
  planHash: string;
  credits: number;
  approvedAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface ApprovalGateOptions {
  estimator: CreditEstimator;
  ttlMs?: number;
  now?: () => number; // inject đồng hồ giả khi test
}

/**
 * Luồng:
 *   propose(plan)      -> Approval Card hiển thị credit      (agent / canvas / MCP đều gọi được)
 *   grant(proposalId)  -> người dùng bấm Duyệt trên UI       (CHỈ nối vào Approval Card)
 *   redeem(plan,token) -> WorkflowRuntime đổi token lấy ApprovedBatch (single-use, nguyên tử)
 *
 * Trạng thái chỉ nằm trong bộ nhớ trang Canvas. Reload studio.html => mọi token chết,
 * phải duyệt lại (fail-closed). Batch đã duyệt và đang chạy được resume bằng ApprovalReceipt
 * trong checkpoint, không dùng lại token.
 */
export class ApprovalGate {
  private readonly estimator: CreditEstimator;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly proposals = new Map<string, ProposalRecord>();
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly waiters = new Map<string, Array<(d: ApprovalDecision) => void>>();

  constructor(opts: ApprovalGateOptions) {
    this.estimator = opts.estimator;
    this.ttlMs = opts.ttlMs ?? APPROVAL_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async propose(plan: RenderPlan): Promise<ApprovalProposal> {
    const snapshot = normalizePlan(plan);
    const credits = this.estimate(snapshot);
    const planHash = await computePlanHash(snapshot, credits);

    this.prune();
    const now = this.now();
    const rec: ProposalRecord = {
      proposalId: crypto.randomUUID(),
      planHash,
      credits,
      model: snapshot.model,
      sceneCount: snapshot.scenes.length,
      proposedAt: now,
      expiresAt: now + this.ttlMs,
      status: 'pending',
    };
    this.proposals.set(rec.proposalId, rec);
    return {
      proposalId: rec.proposalId,
      planHash,
      credits,
      model: rec.model,
      sceneCount: rec.sceneCount,
      proposedAt: rec.proposedAt,
      expiresAt: rec.expiresAt,
    };
  }

  /** CHỈ gọi từ Approval Card (xử lý click thật của người dùng). Không đưa vào agent/MCP. */
  grant(proposalId: string): ApprovalToken {
    this.prune();
    const p = this.getProposal(proposalId);
    const now = this.now();
    if (p.status !== 'pending') {
      throw new ApprovalError('PROPOSAL_NOT_PENDING', `Đề xuất đã ở trạng thái "${p.status}".`);
    }
    if (now >= p.expiresAt) {
      throw new ApprovalError('PROPOSAL_EXPIRED', 'Đề xuất duyệt đã hết hạn, hãy gửi duyệt lại.');
    }
    const token = `fgat_${randomHex(24)}`;
    const issued: ApprovalToken = {
      token,
      proposalId,
      planHash: p.planHash,
      credits: p.credits,
      issuedAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.tokens.set(token, {
      proposalId,
      planHash: p.planHash,
      credits: p.credits,
      approvedAt: now,
      expiresAt: issued.expiresAt,
      usedAt: null,
    });
    p.status = 'granted';
    p.token = issued;
    this.notify(proposalId, { status: 'granted', token: issued });
    return issued;
  }

  reject(proposalId: string): void {
    const p = this.getProposal(proposalId);
    if (p.status !== 'pending') return;
    p.status = 'rejected';
    this.notify(proposalId, { status: 'rejected' });
  }

  /** Tool request_render_approval của agent chờ quyết định của người dùng ở đây. */
  awaitDecision(proposalId: string, timeoutMs: number = this.ttlMs): Promise<ApprovalDecision> {
    const p = this.getProposal(proposalId);
    if (p.status === 'granted' && p.token) return Promise.resolve({ status: 'granted', token: p.token });
    if (p.status === 'rejected') return Promise.resolve({ status: 'rejected' });

    return new Promise((resolve) => {
      const list = this.waiters.get(proposalId) ?? [];
      const waiter = (d: ApprovalDecision) => {
        clearTimeout(timer);
        resolve(d);
      };
      const timer = setTimeout(() => {
        const rest = (this.waiters.get(proposalId) ?? []).filter((w) => w !== waiter);
        if (rest.length) this.waiters.set(proposalId, rest);
        else this.waiters.delete(proposalId);
        resolve({ status: 'timeout' });
      }, timeoutMs);
      list.push(waiter);
      this.waiters.set(proposalId, list);
    });
  }

  /**
   * Cổng duy nhất để có ApprovedBatch. Kiểm tra theo thứ tự:
   * có token -> token tồn tại -> chưa dùng -> chưa hết hạn -> hash khớp nội dung thực tế.
   */
  async redeem(plan: RenderPlan, token: string | undefined): Promise<ApprovedBatch> {
    if (!token) {
      throw new ApprovalError('TOKEN_MISSING', 'Thiếu token duyệt credit. Gọi request_render_approval trước.');
    }
    // 1) Chụp snapshot TRƯỚC mọi await: caller sửa object sau đó cũng không đổi thứ được chạy.
    const snapshot = normalizePlan(plan);
    // 2) Tự tính lại credit, không tin con số từ caller.
    const credits = this.estimate(snapshot);
    const planHash = await computePlanHash(snapshot, credits);

    // 3) Từ đây không còn await: kiểm tra + đánh dấu đã dùng là nguyên tử.
    //    Hai lệnh song song cùng token => đúng một lệnh qua.
    const now = this.now();
    this.prune();
    const rec = this.tokens.get(token);
    if (!rec) throw new ApprovalError('TOKEN_UNKNOWN', 'Token không tồn tại (có thể đã reload studio hoặc quá cũ).');
    if (rec.usedAt !== null) throw new ApprovalError('TOKEN_ALREADY_USED', 'Token đã được dùng. Mỗi lần duyệt chỉ chạy một lần.');
    if (now >= rec.expiresAt) throw new ApprovalError('TOKEN_EXPIRED', 'Token đã hết hạn (quá 5 phút). Hãy gửi duyệt lại.');
    if (rec.planHash !== planHash) {
      // Không đốt token khi lệch nội dung: token hợp lệ vẫn dùng được cho đúng kế hoạch đã duyệt.
      throw new ApprovalError('PLAN_MISMATCH', 'Kịch bản, model hoặc credit khác với bản đã duyệt. Hãy gửi duyệt lại.');
    }
    rec.usedAt = now;

    const batch = {
      plan: snapshot,
      receipt: Object.freeze({
        proposalId: rec.proposalId,
        planHash,
        credits,
        model: snapshot.model,
        sceneIds: Object.freeze(snapshot.scenes.map((s) => s.sceneId)),
        approvedAt: rec.approvedAt,
        redeemedAt: now,
      }),
    };
    return Object.freeze(batch) as unknown as ApprovedBatch;
  }

  private estimate(plan: RenderPlan): number {
    const credits = this.estimator.estimate(plan);
    if (!Number.isFinite(credits) || credits < 0) {
      throw new ApprovalError('BAD_ESTIMATE', 'Không ước tính được credit hợp lệ.');
    }
    return credits;
  }

  private getProposal(id: string): ProposalRecord {
    const p = this.proposals.get(id);
    if (!p) throw new ApprovalError('PROPOSAL_UNKNOWN', 'Không tìm thấy đề xuất duyệt.');
    return p;
  }

  private notify(proposalId: string, decision: ApprovalDecision): void {
    const list = this.waiters.get(proposalId);
    if (!list) return;
    this.waiters.delete(proposalId);
    for (const w of list) w(decision);
  }

  /** Giữ bản ghi hết hạn thêm một TTL để báo đúng lỗi (EXPIRED thay vì UNKNOWN). */
  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, p] of this.proposals) if (p.expiresAt < cutoff) this.proposals.delete(id);
    for (const [t, r] of this.tokens) if (r.expiresAt < cutoff) this.tokens.delete(t);
  }
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

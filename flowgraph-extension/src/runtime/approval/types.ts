import type { ApprovalErrorCode, ApprovalReceipt, RenderPlan } from '../../shared/approval-types';

// Các kiểu dữ liệu thuần nay nằm ở shared/ để Agent/MCP dùng được mà không import runtime/.
export type {
  ApprovalDecision,
  ApprovalErrorCode,
  ApprovalProposal,
  ApprovalReceipt,
  ApprovalToken,
  NodeType,
  RenderPlan,
  SceneSpec,
} from '../../shared/approval-types';

// Brand chỉ tồn tại ở mức type: executor yêu cầu ApprovedBatch nên compiler
// chặn mọi đường gọi render không đi qua ApprovalGate.redeem().
export declare const approvedBrand: unique symbol;

/** Do credit-estimator.ts cung cấp. Gate tự gọi lại lúc redeem, không tin số từ caller. */
export interface CreditEstimator {
  estimate(plan: RenderPlan): number;
}

export interface ApprovedBatch {
  readonly [approvedBrand]: true;
  readonly plan: RenderPlan;
  readonly receipt: ApprovalReceipt;
}

/** Lỗi có mã cố định để agent đọc và tự xử lý (vd: PLAN_MISMATCH -> gửi duyệt lại). */
export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;
  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
  }
}

// Kiểu dữ liệu thuần của luồng duyệt credit. Không import chrome.*, không import runtime/.
// runtime/approval/types.ts re-export lại các kiểu này để code cũ giữ nguyên import.

export type NodeType = 't2i' | 'i2v' | 't2v';

export interface SceneSpec {
  sceneId: string;
  nodeType: NodeType;
  prompt: string;
  durationSec: number;
  imageArtifactId?: string; // keyframe cho i2v
}

export interface RenderPlan {
  model: string; // vd: 'veo-3.1-fast'
  scenes: readonly SceneSpec[];
}

/** Dữ liệu cho Approval Card hiển thị. */
export interface ApprovalProposal {
  proposalId: string;
  planHash: string;
  credits: number;
  model: string;
  sceneCount: number;
  proposedAt: number;
  expiresAt: number;
}

export interface ApprovalToken {
  token: string;
  proposalId: string;
  planHash: string;
  credits: number;
  issuedAt: number;
  expiresAt: number;
}

export type ApprovalDecision =
  | { status: 'granted'; token: ApprovalToken }
  | { status: 'rejected' }
  | { status: 'timeout' };

/** Biên nhận lưu vào checkpoint, để resume sau reload mà không cần token mới. */
export interface ApprovalReceipt {
  proposalId: string;
  planHash: string;
  credits: number;
  model: string;
  sceneIds: readonly string[];
  approvedAt: number;
  redeemedAt: number;
}

export type ApprovalErrorCode =
  | 'INVALID_PLAN'
  | 'BAD_ESTIMATE'
  | 'PROPOSAL_UNKNOWN'
  | 'PROPOSAL_EXPIRED'
  | 'PROPOSAL_NOT_PENDING'
  | 'TOKEN_MISSING'
  | 'TOKEN_UNKNOWN'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_ALREADY_USED'
  | 'PLAN_MISMATCH';

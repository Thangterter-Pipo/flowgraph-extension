// Luật đồ thị và bất biến hệ thống, dùng chung cho WorkflowRuntime thật, guardrails và mock.
// Một nguồn sự thật: đổi luật ở đây thì runtime, agent và eval cùng đổi.

import type { RenderPlan } from './approval-types';
import type { ApiError, EdgeKind, NodeKind, NodeParams } from './bridge-types';

export const MAX_VIDEO_SECONDS = 8;
export const MAX_PROMPT_CHARS = 2000;

/** Cổng vào/ra của từng loại node. Chỉnh theo đúng pipeline thực tế của bạn. */
export const NODE_PORTS: Record<NodeKind, { accepts: readonly EdgeKind[]; emits: EdgeKind | null }> = {
  prompt: { accepts: [], emits: 'PROMPT' },
  t2i: { accepts: ['PROMPT'], emits: 'IMAGE' },
  i2v: { accepts: ['IMAGE', 'PROMPT'], emits: 'VIDEO' },
  t2v: { accepts: ['PROMPT'], emits: 'VIDEO' },
  videoConcat: { accepts: ['VIDEO'], emits: 'VIDEO' },
  preview: { accepts: ['VIDEO'], emits: null },
  download: { accepts: ['VIDEO'], emits: null },
};

export function canConnect(source: NodeKind, edge: EdgeKind, target: NodeKind): boolean {
  return NODE_PORTS[source].emits === edge && NODE_PORTS[target].accepts.includes(edge);
}

const violation = (message: string): ApiError => ({ code: 'INVARIANT_VIOLATION', message });
const isVideoKind = (k: string) => k === 'i2v' || k === 't2v';
const looksLikeUrl = (s: string) => /^https?:/i.test(s);

/** Kiểm tra tham số node khi tạo/sửa. */
export function checkNodeParams(kind: NodeKind, params: NodeParams): ApiError | null {
  if (isVideoKind(kind) && params.durationSec !== undefined && params.durationSec > MAX_VIDEO_SECONDS) {
    return violation(
      `Node ${kind} dài ${params.durationSec}s, vượt ${MAX_VIDEO_SECONDS}s. Tách thành nhiều cảnh ≤ ${MAX_VIDEO_SECONDS}s rồi nối bằng videoConcat.`,
    );
  }
  if (params.prompt !== undefined && params.prompt.length > MAX_PROMPT_CHARS) {
    return violation(`Prompt dài ${params.prompt.length} ký tự, vượt ${MAX_PROMPT_CHARS}.`);
  }
  if (params.imageArtifactId !== undefined && looksLikeUrl(params.imageArtifactId)) {
    return violation('Không lưu URL CDN tạm (sẽ hết hạn). Dùng artifactId dạng "stitch-idb:...".');
  }
  return null;
}

/**
 * Kiểm tra kế hoạch render TRƯỚC khi xin duyệt credit.
 * Kế hoạch sai cấu trúc (rỗng, thiếu model...) để ApprovalGate báo INVALID_PLAN.
 */
export function checkPlanInvariants(plan: RenderPlan): ApiError | null {
  if (!plan || !Array.isArray(plan.scenes)) return null;
  for (const s of plan.scenes) {
    if (isVideoKind(s.nodeType) && s.durationSec > MAX_VIDEO_SECONDS) {
      return violation(
        `Cảnh ${s.sceneId} dài ${s.durationSec}s, vượt ${MAX_VIDEO_SECONDS}s. Tách thành nhiều cảnh ≤ ${MAX_VIDEO_SECONDS}s rồi nối bằng videoConcat.`,
      );
    }
    if (typeof s.prompt === 'string' && s.prompt.length > MAX_PROMPT_CHARS) {
      return violation(`Cảnh ${s.sceneId}: prompt dài ${s.prompt.length} ký tự, vượt ${MAX_PROMPT_CHARS}.`);
    }
    if (s.imageArtifactId && looksLikeUrl(s.imageArtifactId)) {
      return violation(`Cảnh ${s.sceneId}: imageArtifactId là URL. Dùng artifactId "stitch-idb:...".`);
    }
  }
  return null;
}

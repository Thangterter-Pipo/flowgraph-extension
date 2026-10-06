import { ApprovalError } from './types';
import type { NodeType, RenderPlan, SceneSpec } from './types';
import { canonicalJson } from '../../shared/canonical-json';

export { canonicalJson };

// Domain separation + version: đổi định dạng payload thì tăng v2, token cũ tự vô hiệu.
const HASH_DOMAIN = 'flowgraph/render-approval/v1\n';
const NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['t2i', 'i2v', 't2v']);

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Chụp snapshot bất biến của kế hoạch, CHỈ giữ các trường có ý nghĩa với render.
 * - Trường UI (vị trí node, màu...) không ảnh hưởng hash.
 * - Caller sửa object gốc sau đó cũng không ảnh hưởng snapshot.
 * Thứ tự cảnh được giữ nguyên vì nó là một phần của kế hoạch.
 */
export function normalizePlan(plan: RenderPlan): RenderPlan {
  if (!plan || typeof plan.model !== 'string' || plan.model.trim() === '') {
    throw new ApprovalError('INVALID_PLAN', 'Kế hoạch thiếu model.');
  }
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    throw new ApprovalError('INVALID_PLAN', 'Kế hoạch không có cảnh nào.');
  }
  const seen = new Set<string>();
  const scenes = plan.scenes.map((s): SceneSpec => {
    if (!s.sceneId || seen.has(s.sceneId)) {
      throw new ApprovalError('INVALID_PLAN', `sceneId trống hoặc trùng: "${s.sceneId}".`);
    }
    seen.add(s.sceneId);
    if (!NODE_TYPES.has(s.nodeType)) {
      throw new ApprovalError('INVALID_PLAN', `nodeType không hợp lệ ở cảnh ${s.sceneId}.`);
    }
    if (typeof s.prompt !== 'string' || !Number.isFinite(s.durationSec) || s.durationSec <= 0) {
      throw new ApprovalError('INVALID_PLAN', `prompt/durationSec không hợp lệ ở cảnh ${s.sceneId}.`);
    }
    const base: SceneSpec = {
      sceneId: s.sceneId,
      nodeType: s.nodeType,
      prompt: s.prompt,
      durationSec: s.durationSec,
    };
    return Object.freeze(s.imageArtifactId ? { ...base, imageArtifactId: s.imageArtifactId } : base);
  });
  return Object.freeze({ model: plan.model, scenes: Object.freeze(scenes) });
}

/** Hash ràng buộc: danh sách cảnh + model + số credit ước tính. Nhận plan đã normalize. */
export async function computePlanHash(plan: RenderPlan, credits: number): Promise<string> {
  const payload = { model: plan.model, credits, scenes: plan.scenes };
  const bytes = new TextEncoder().encode(HASH_DOMAIN + canonicalJson(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

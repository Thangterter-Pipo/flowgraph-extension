import type { CreditsData } from '../../shared/bridge';

export const HISTORY_KEY = 'flowgraph.runHistory.v1';
export const LEGACY_HISTORY_KEY = 'flowgraph.runHistory';

export function creditsView(data: CreditsData | undefined, loading: boolean) {
  if (loading) return { state: 'loading', text: 'Đang tải…' };
  if (data?.error) return { state: 'error', text: 'Không đọc được số dư' };
  if (typeof data?.credits !== 'number' || !Number.isFinite(data.credits) || data.credits < 0) {
    return { state: 'unknown', text: 'Chưa xác định' };
  }
  return { state: data.credits === 0 ? 'zero' : 'known', text: data.credits.toLocaleString('vi-VN') };
}

export function runStatusText(status?: string): string {
  const labels: Record<string, string> = {
    success: 'Thành công', failed: 'Thất bại', cancelled: 'Đã hủy', canceled: 'Đã hủy',
    running: 'Đang chạy', validating: 'Đang kiểm tra', queued: 'Đang chờ', skipped: 'Đã bỏ qua',
  };
  return labels[status ?? ''] ?? 'Chưa xác định';
}

export interface LastRun {
  runId: string;
  projectId?: string;
  workflowName?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
}

export function readLastRun(raw: string | null, projectId?: string): LastRun | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Lịch sử chạy không đúng định dạng.');
  const runs = parsed.filter((item): item is LastRun => item && typeof item === 'object'
    && typeof item.runId === 'string'
    && ['projectId', 'workflowName', 'status', 'startedAt', 'finishedAt'].every(
      (key) => item[key] === undefined || typeof item[key] === 'string'));
  // Legacy records have no project id: label them unscoped, never infer ownership.
  return (projectId ? runs.find((run) => run.projectId === projectId) ?? runs.find((run) => !run.projectId) : runs[0]) ?? null;
}

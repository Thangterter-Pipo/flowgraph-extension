import { runStatusText } from './state';

export type FlowgraphRuntimeEventMessage = {
  kind?: string;
  runId?: string;
  nodeId?: string;
  status?: string;
  error?: { message?: string };
};

export function formatFlowgraphRuntimeEvent(message: FlowgraphRuntimeEventMessage): string {
  const kind = message.kind ?? '';
  if (kind === 'node:status') {
    const base = `Nút [${message.nodeId || '?'}]: ${runStatusText(message.status)}`;
    if (message.error?.message) {
      return `${base} — ${message.error.message}`;
    }
    return base;
  }
  if (kind === 'node:result') {
    return `Nút [${message.nodeId || '?'}]: Thành công`;
  }
  if (kind === 'run:state') {
    return `Lượt chạy [${(message.runId || '?').slice(0, 8)}]: ${runStatusText(message.status)}${message.error?.message ? ` — ${message.error.message}` : ''}`;
  }
  if (kind === 'run:error') {
    return `Lỗi lượt chạy: ${message.error?.message || 'Không có chi tiết lỗi'}`;
  }
  return `Sự kiện thực thi: ${kind || 'chưa xác định'}`;
}

export function shouldRefreshLastRun(message: FlowgraphRuntimeEventMessage): boolean {
  if (message.kind === 'run:error') return true;
  return message.kind === 'run:state'
    && (message.status === 'success' || message.status === 'failed' || message.status === 'cancelled' || message.status === 'canceled');
}

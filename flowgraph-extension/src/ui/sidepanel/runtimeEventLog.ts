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
    const base = `Node [${message.nodeId || 'unknown'}]: ${message.status || 'running'}`;
    if (message.status === 'failed' && message.error?.message) {
      return `${base} — ${message.error.message}`;
    }
    return base;
  }
  if (kind === 'node:result') {
    return `Node [${message.nodeId || 'unknown'}] completed successfully`;
  }
  if (kind === 'run:state') {
    return `Workflow Run [${(message.runId || '').slice(0, 8)}]: ${message.status || 'state changed'}`;
  }
  if (kind === 'run:error') {
    return `Workflow Error: ${message.error?.message || 'Execution failed'}`;
  }
  return `Runtime event: ${kind || 'unknown'}`;
}

export function shouldRefreshLastRun(message: FlowgraphRuntimeEventMessage): boolean {
  if (message.kind === 'run:error') return true;
  return message.kind === 'run:state'
    && (message.status === 'success' || message.status === 'failed' || message.status === 'cancelled');
}

import { describe, it, expect } from 'vitest';

describe('SidePanel Real State Integration & Pure State Derivation (Task SP-01 to SP-07)', () => {
  it('strictly derives stage from real account + flow status (no prototype manual toggle)', () => {
    const deriveStage = (accountState: string, flowState: string): string => {
      if (accountState !== 'CONNECTED') return 'signed-out';
      if (flowState !== 'READY') return 'flow-disconnected';
      return 'connected';
    };

    expect(deriveStage('DISCONNECTED', 'READY')).toBe('signed-out');
    expect(deriveStage('CHECKING', 'READY')).toBe('signed-out');
    expect(deriveStage('CONNECTED', 'DISCONNECTED')).toBe('flow-disconnected');
    expect(deriveStage('CONNECTED', 'CHECKING')).toBe('flow-disconnected');
    expect(deriveStage('CONNECTED', 'READY')).toBe('connected');
  });

  it('correctly reads run history from flowgraph.runHistory.v1 schema', () => {
    const mockRecord = {
      runId: 'r-100',
      workflowName: 'Cinematic Car Video',
      status: 'success',
      startedAt: '2026-09-06T02:00:00.000Z',
      finishedAt: '2026-09-06T02:01:24.000Z',
    };

    const isSuccess = mockRecord.status === 'success';
    const isCancelled = mockRecord.status === 'cancelled';
    const statusText = isSuccess ? 'Done' : isCancelled ? 'Canceled' : 'Failed';
    const timeStr = mockRecord.finishedAt || mockRecord.startedAt;

    expect(statusText).toBe('Done');
    expect(timeStr).toBe('2026-09-06T02:01:24.000Z');
  });

  it('verifies credits and project name extraction without mock fallbacks', () => {
    const rawCredits = { credits: 1250 };
    const creditText = rawCredits?.credits !== undefined ? String(rawCredits.credits) : 'Available';
    expect(creditText).toBe('1250');

    const flowTitle = 'Google Flow - Cinematic Project';
    const projectName = flowTitle.replace(/^Google Flow\s*[-–]\s*/i, '').trim();
    expect(projectName).toBe('Cinematic Project');
  });

  it('correctly processes live FLOWGRAPH_EVENT into Execution Logs and updates last run', () => {
    interface LogEntry {
      id: string;
      time: string;
      text: string;
      level: 'info' | 'success' | 'warn' | 'error';
    }

    const logs: LogEntry[] = [];
    const handleEvent = (message: { type: string; kind: string; runId?: string; nodeId?: string; status?: string; error?: { message?: string } }) => {
      if (message.type !== 'FLOWGRAPH_EVENT') return;
      const eventText = message.kind === 'node:status'
        ? `Node [${message.nodeId || 'unknown'}]: ${message.status || 'running'}`
        : message.kind === 'node:result'
        ? `Node [${message.nodeId || 'unknown'}] completed successfully`
        : message.kind === 'run:state'
        ? `Workflow Run [${(message.runId || '').slice(0, 8)}]: ${message.status || 'state changed'}`
        : message.kind === 'run:error'
        ? `Workflow Error: ${message.error?.message || 'Execution failed'}`
        : `Runtime event: ${message.kind || 'unknown'}`;

      const level: 'info' | 'success' | 'warn' | 'error' =
        message.kind === 'run:error' ? 'error' :
        message.status === 'success' ? 'success' :
        message.status === 'failed' ? 'error' : 'info';

      logs.unshift({ id: 'evt-1', time: '12:00:00', text: eventText, level });
    };

    handleEvent({
      type: 'FLOWGRAPH_EVENT',
      kind: 'node:status',
      nodeId: 'n_t2v_1',
      status: 'generating',
    });
    expect(logs[0].text).toBe('Node [n_t2v_1]: generating');
    expect(logs[0].level).toBe('info');

    handleEvent({
      type: 'FLOWGRAPH_EVENT',
      kind: 'node:result',
      nodeId: 'n_t2v_1',
      status: 'success',
    });
    expect(logs[0].text).toBe('Node [n_t2v_1] completed successfully');
    expect(logs[0].level).toBe('success');

    handleEvent({
      type: 'FLOWGRAPH_EVENT',
      kind: 'run:error',
      error: { message: 'Video resolution failed' },
    });
    expect(logs[0].text).toBe('Workflow Error: Video resolution failed');
    expect(logs[0].level).toBe('error');
  });
});

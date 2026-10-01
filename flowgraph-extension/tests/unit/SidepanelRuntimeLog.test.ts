import { describe, expect, it } from 'vitest';
import { formatFlowgraphRuntimeEvent } from '../../src/ui/sidepanel/runtimeEventLog';

describe('sidepanel runtime event log', () => {
  it('prints the node error message instead of a bare failed status', () => {
    expect(formatFlowgraphRuntimeEvent({
      kind: 'node:status',
      nodeId: '3',
      status: 'failed',
      error: { message: 'Flow model did not commit "Omni 1.1 Flash" (chip: Video · 720p · 8 giây crop_16_9 x1).' },
    })).toBe('Nút [3]: Thất bại — Flow model did not commit "Omni 1.1 Flash" (chip: Video · 720p · 8 giây crop_16_9 x1).');
  });

  it('prints the run error instead of a generic Execution failed when a message exists', () => {
    expect(formatFlowgraphRuntimeEvent({
      kind: 'run:error',
      runId: '7d8971ae-aaaa',
      error: { message: 'Flow model did not commit "Omni 1.1 Flash" (chip: Video · 720p · 8 giây crop_16_9 x1).' },
    })).toBe('Lỗi lượt chạy: Flow model did not commit "Omni 1.1 Flash" (chip: Video · 720p · 8 giây crop_16_9 x1).');
  });

  it('keeps success and queued lines compact', () => {
    expect(formatFlowgraphRuntimeEvent({ kind: 'node:result', nodeId: '1' })).toBe('Nút [1]: Thành công');
    expect(formatFlowgraphRuntimeEvent({ kind: 'node:status', nodeId: '3', status: 'queued' })).toBe('Nút [3]: Đang chờ');
    expect(formatFlowgraphRuntimeEvent({ kind: 'run:state', runId: '7d8971ae-aaaa', status: 'running' })).toBe('Lượt chạy [7d8971ae]: Đang chạy');
  });
});

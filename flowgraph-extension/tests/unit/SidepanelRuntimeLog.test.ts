import { describe, expect, it } from 'vitest';
import { formatFlowgraphRuntimeEvent } from '../../src/ui/sidepanel/runtimeEventLog';

describe('sidepanel runtime event log', () => {
  it('prints the node error message instead of a bare failed status', () => {
    expect(formatFlowgraphRuntimeEvent({
      kind: 'node:status',
      nodeId: '3',
      status: 'failed',
      error: { message: 'Flow model did not commit "Omni 1.1 Flash" (chip: Video · 720p · 8 giây crop_16_9 x1).' },
    })).toBe('Node [3]: failed — Flow model did not commit "Omni 1.1 Flash" (chip: Video · 720p · 8 giây crop_16_9 x1).');
  });

  it('prints the run error instead of a generic Execution failed when a message exists', () => {
    expect(formatFlowgraphRuntimeEvent({
      kind: 'run:error',
      runId: '7d8971ae-aaaa',
      error: { message: 'Flow model did not commit "Omni 1.1 Flash" (chip: Video · 720p · 8 giây crop_16_9 x1).' },
    })).toBe('Workflow Error: Flow model did not commit "Omni 1.1 Flash" (chip: Video · 720p · 8 giây crop_16_9 x1).');
  });

  it('keeps success and queued lines compact', () => {
    expect(formatFlowgraphRuntimeEvent({ kind: 'node:result', nodeId: '1' })).toBe('Node [1] completed successfully');
    expect(formatFlowgraphRuntimeEvent({ kind: 'node:status', nodeId: '3', status: 'queued' })).toBe('Node [3]: queued');
    expect(formatFlowgraphRuntimeEvent({ kind: 'run:state', runId: '7d8971ae-aaaa', status: 'running' })).toBe('Workflow Run [7d8971ae]: running');
  });
});

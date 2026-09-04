import { describe, expect, it } from 'vitest';
import { RealGoogleFlowAdapter, type BridgeTransport } from '../../src/adapters/google-flow/GoogleFlowAdapter';
import { makeResponse, type RequestType } from '../../src/shared/bridge';
import type { FlowSyncEvent } from '../../src/shared/sync/FlowSyncTypes';
import { normalizeFlowUiModelLabel } from '../../src/shared/sync/SyncCapabilityRegistry';

const event: FlowSyncEvent = {
  syncId: 'studio-model-7',
  timestamp: '2026-09-04T00:00:00.000Z',
  source: 'FLOWGRAPH',
  projectId: '729eaa19-1c85-4cfc-89c3-5f86de2dffc5',
  nodeId: 't2v',
  field: 'model',
  value: 'Omni 1.1 Flash',
  sequence: 7,
  originEventId: 'studio-model-7',
};

describe('RealGoogleFlowAdapter realtime sync', () => {
  it('normalizes Studio registry decorations and the legacy Omni label for Flow UI', () => {
    expect(normalizeFlowUiModelLabel('🍌 Nano Banana 2')).toBe('Nano Banana 2');
    expect(normalizeFlowUiModelLabel('Omni Flash')).toBe('Omni 1.1 Flash');
    expect(normalizeFlowUiModelLabel('Veo 3.1 - Quality')).toBe('Veo 3.1 - Quality');
  });

  it('keeps project, node, sequence, and origin identity on a sync write', async () => {
    const calls: Array<{ type: RequestType; payload: unknown }> = [];
    const transport: BridgeTransport = {
      request: async <T>(type: RequestType, payload?: unknown) => {
        calls.push({ type, payload });
        return makeResponse<T>('transport-test', { applied: true } as T);
      },
    };

    await new RealGoogleFlowAdapter(transport).writeSync(event);

    expect(calls).toEqual([{
      type: 'FLOWGRAPH_SYNC_SET_MODEL',
      payload: {
        syncId: 'studio-model-7',
        projectId: '729eaa19-1c85-4cfc-89c3-5f86de2dffc5',
        nodeId: 't2v',
        value: 'Omni 1.1 Flash',
        sequence: 7,
        originEventId: 'studio-model-7',
      },
    }]);
  });

  it('fails closed when a sync event has no field mapping', async () => {
    const transport: BridgeTransport = {
      request: async <T>() => makeResponse<T>('unused', {} as T),
    };
    const result = await new RealGoogleFlowAdapter(transport).writeSync({ ...event, field: undefined });
    expect(result).toEqual({ ok: false, message: 'Sync event carried no field.' });
  });
});

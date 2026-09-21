import { describe, expect, it } from 'vitest';
import { buildRunModePlan, runNodeSignatures, createRunReceipt } from '../../src/ui/studio/workflowRunMode';
import { hydrateNodeData, paletteSpecForKind, type FlowNode, type NodeStatus } from '../../src/ui/studio/model';

const node = (id: string, kind: string, status: NodeStatus = 'success'): FlowNode => ({
  id, type: 'flowNode', position: { x: 0, y: 0 }, data: { ...hydrateNodeData(paletteSpecForKind(kind)!), kind, status, config: { prompt: 'boat' },
    result: { type: 'image', mediaId: `media-${id}`, projectId: 'p', previewUrl: '' },
  },
});
const edges = [{ id: 'e', source: 'a', sourceHandle: 'image', target: 'b', targetHandle: 'media' }];

describe('workflow run modes', () => {
  it('does not reuse an unverified IndexedDB artifact merely from its receipt', () => {
    const n = node('a', 'videoConcat');
    n.data.runReceipt = createRunReceipt(runNodeSignatures([n], [], 'p').get('a')!, {
      video: { type: 'video', value: { provider: 'GOOGLE_FLOW', type: 'VIDEO', mediaId: 'stitch-idb:missing', projectId: 'p' } },
    });
    expect(buildRunModePlan('continue', [n], [], 'p').reuse).toEqual([]);
  });
  it.each([
    ['t2i', 'image', 'VIDEO'], ['t2v', 'video', 'IMAGE'],
    ['preview', 'image', 'VIDEO'], ['preview', 'video', 'IMAGE'],
  ] as const)('rejects %s outer %s / inner %s mismatch', (kind, type, inner) => {
    const n = node('a', kind);
    n.data.runReceipt = createRunReceipt(runNodeSignatures([n], [], 'p').get('a')!, {
      [kind === 'preview' ? 'media' : type]: { type, value: { provider: 'GOOGLE_FLOW', type: inner, mediaId: 'm', projectId: 'p' } },
    });
    expect(buildRunModePlan('continue', [n], [], 'p').reuse).toEqual([]);
  });
  it.each(['stitched-123', 'concat-123'])('never reuses pseudo provider artifact %s after JSON roundtrip', (mediaId) => {
    const n = node('a', 't2v');
    n.data.runReceipt = JSON.parse(JSON.stringify(createRunReceipt(runNodeSignatures([n], [], 'p').get('a')!, {
      video: { type: 'video', value: { provider: 'GOOGLE_FLOW', type: 'VIDEO', mediaId, projectId: 'p', uri: 'blob:gone' } },
    })));
    const plan = buildRunModePlan('continue', [n], [], 'p');
    expect(plan.reuse).toEqual([]);
    expect(plan.initialOutputs.size).toBe(0);
    expect(plan.run).toEqual(['a']);
    expect(JSON.stringify(n.data.runReceipt)).not.toContain('blob:');
  });
  it.each([undefined, null])('blocks legacy success without a receipt (%s) and all downstream without fabricating outputs', (receipt) => {
    const nodes = [node('a', 't2i'), node('b', 'preview', 'idle'), node('c', 'preview', 'failed')];
    nodes[0].data.runReceipt = receipt;
    const links = [...edges, { id: 'bc', source: 'b', target: 'c' }];
    const before = JSON.stringify(nodes);
    const plan = buildRunModePlan('continue', nodes, links, 'p');
    expect(plan.blocked).toEqual(['a', 'b', 'c']);
    expect(plan.run).toEqual([]);
    expect(plan.reuse).toEqual([]);
    expect(plan.initialOutputs.size).toBe(0);
    expect(plan.initialCompleted.size).toBe(0);
    expect(plan.bypassCacheNodeIds.size).toBe(0);
    expect(plan.blockReason).toMatch(/Restart.*credit/);
    expect(JSON.stringify(nodes)).toBe(before);
    const restart = buildRunModePlan('restart', nodes, links, 'p');
    expect(restart.blocked).toEqual([]);
    expect(restart.run).toEqual(['a', 'b', 'c']);
  });
  it.each(['failed', 'idle', 'queued', 'skipped'] as NodeStatus[])('reopens %s while preserving an independent success', (status) => {
    const nodes = [node('a', 't2i', status), node('b', 'preview'), node('c', 't2i'), node('d', 'preview')];
    const links = [...edges, { id: 'cd', source: 'c', sourceHandle: 'image', target: 'd', targetHandle: 'media' }];
    const signatures = runNodeSignatures(nodes, links, 'p');
    for (const n of nodes) n.data.runReceipt = createRunReceipt(signatures.get(n.id)!, {
      [n.data.kind === 't2i' ? 'image' : 'media']: { type: 'image', value: { provider: 'GOOGLE_FLOW', type: 'IMAGE', mediaId: 'm', projectId: 'p' } },
    });
    const plan = buildRunModePlan('continue', nodes, links, 'p');
    expect(plan.run).toEqual(['a', 'b']);
    expect(plan.reuse).toEqual(['c', 'd']);
    expect(plan.bypassCacheNodeIds).toEqual(new Set(['a', 'b']));
  });
  it('rejects missing, local, cross-project and wrong-handle outputs', () => {
    const n = node('a', 't2i');
    const signature = runNodeSignatures([n], [], 'p').get('a')!;
    for (const outputs of [{}, { video: { type: 'video', value: {} } },
      { image: { type: 'image', value: { provider: 'GOOGLE_FLOW', type: 'IMAGE', mediaId: 'local-a', projectId: 'p' } } },
      { image: { type: 'image', value: { provider: 'GOOGLE_FLOW', type: 'IMAGE', mediaId: 'm', projectId: 'other' } } }]) {
      n.data.runReceipt = { signature, outputs };
      expect(buildRunModePlan('continue', [n], [], 'p').run).toEqual(['a']);
    }
  });
  it('persists complete receipts without transient URLs, including nested character media', () => {
    const receipt = createRunReceipt('signature', { character: { type: 'character', value: {
      name: 'A', image: { mediaId: 'm', projectId: 'p', previewUrl: 'https://signed.invalid?token=secret', uri: 'blob:transient' },
    } } });
    expect(JSON.stringify(receipt)).not.toContain('signed.invalid');
    expect(receipt.outputs.character.value).toEqual({ name: 'A', image: { mediaId: 'm', projectId: 'p' } });
  });
  it('continue reuses completed sinks and media even with an expired URL; changes reopen downstream', () => {
    const nodes = [node('a', 't2i'), node('b', 'preview')];
    const signatures = runNodeSignatures(nodes, edges, 'p');
    for (const n of nodes) n.data.runReceipt = { signature: signatures.get(n.id), outputs: { [n.id === 'a' ? 'image' : 'media']: { type: 'image', value: { provider: 'GOOGLE_FLOW', type: 'IMAGE', mediaId: 'm', projectId: 'p' } } } };
    expect(buildRunModePlan('continue', nodes, edges, 'p').run).toEqual([]);
    nodes[0].data.result!.previewUrl = 'https://expired.invalid';
    expect(buildRunModePlan('continue', nodes, edges, 'p').reuse).toEqual(['a', 'b']);
    nodes[0].data.config.prompt = 'changed';
    expect(buildRunModePlan('continue', nodes, edges, 'p').run).toEqual(['a', 'b']);
  });

  it('failed and pending nodes reopen downstream but preserve independent successes', () => {
    const nodes = [node('a', 't2i'), node('b', 'preview')];
    const signatures = runNodeSignatures(nodes, edges, 'p');
    for (const n of nodes) n.data.runReceipt = { signature: signatures.get(n.id), outputs: {} };
    nodes[0].data.status = 'failed';
    expect(buildRunModePlan('continue', nodes, edges, 'p').run).toEqual(['a', 'b']);
    expect(buildRunModePlan('continue', nodes, edges, 'other').reuse).toEqual([]);
  });
  it('restart runs output scope without seeding generated successes or touching the graph', () => {
    const nodes = [node('a', 't2i'), node('b', 'preview'), node('outside', 't2i')];
    const before = JSON.stringify(nodes);
    const plan = buildRunModePlan('restart', nodes, edges, 'p');
    expect(plan.run).toEqual(['a', 'b']);
    expect(plan.initialCompleted.size).toBe(0);
    expect(plan.bypassCacheNodeIds).toEqual(new Set(['a', 'b']));
    expect(JSON.stringify(nodes)).toBe(before);
  });
});


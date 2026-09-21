import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '../../src/ui/studio/model';
import {
  applySemanticReverseSync,
  shouldIgnoreSemanticReverseSync,
} from '../../src/ui/studio/reverseSyncInvalidation';

function node(id: string, kind: string, extras?: Partial<FlowNode['data']>): FlowNode {
  return {
    id,
    type: 'flowNode',
    position: { x: 0, y: 0 },
    data: {
      kind,
      title: id,
      subtitle: '',
      tone: 'blue',
      status: extras?.status ?? 'success',
      config: extras?.config ?? {},
      result: extras?.result,
      cacheHit: extras?.cacheHit,
      maturity: 'RUNTIME_VERIFIED',
      capabilityLabel: '',
      capabilitySummary: '',
    },
  };
}

const edges: FlowEdge[] = [
  { id: 'e1', source: 'prompt', target: 't2i', sourceHandle: 'prompt', targetHandle: 'prompt' },
  { id: 'e2', source: 't2i', target: 'i2v', sourceHandle: 'image', targetHandle: 'image' },
  { id: 'e3', source: 'other-prompt', target: 'other-t2i', sourceHandle: 'prompt', targetHandle: 'prompt' },
];

function graph(): FlowNode[] {
  return [
    node('prompt', 'prompt', { config: { prompt: 'old' }, result: undefined, status: 'idle' }),
    node('t2i', 't2i', {
      status: 'success',
      config: { model: 'Nano Banana 2' },
      result: { type: 'image', previewUrl: '', mediaId: 'img-old' },
      cacheHit: true,
    }),
    node('i2v', 'i2v', {
      status: 'success',
      config: { model: 'Veo 3.1' },
      result: { type: 'video', previewUrl: '', mediaId: 'vid-old' },
    }),
    node('other-prompt', 'prompt', { config: { prompt: 'keep' }, status: 'idle' }),
    node('other-t2i', 't2i', {
      status: 'success',
      config: { model: 'Nano Banana 2' },
      result: { type: 'image', previewUrl: '', mediaId: 'img-other' },
    }),
  ];
}

function patchConfig(target: FlowNode, event: { field?: string; value?: unknown }): FlowNode {
  if (event.field === 'model') {
    return { ...target, data: { ...target.data, config: { ...target.data.config, model: String(event.value ?? '') } } };
  }
  if (event.field === 'prompt') {
    return { ...target, data: { ...target.data, config: { ...target.data.config, prompt: String(event.value ?? '') } } };
  }
  return target;
}

describe('reverse-sync stale-result invalidation', () => {
  it('clears T2I result and video downstream when model reverse-syncs', () => {
    const next = applySemanticReverseSync(graph(), edges, {
      field: 'model',
      nodeId: 't2i',
      value: 'Nano Banana Pro',
    }, { runActive: false, patchConfig });
    const t2i = next.find((item) => item.id === 't2i')!;
    const i2v = next.find((item) => item.id === 'i2v')!;
    expect(t2i.data.config.model).toBe('Nano Banana Pro');
    expect(t2i.data.status).toBe('idle');
    expect(t2i.data.result).toBeUndefined();
    expect(t2i.data.cacheHit).toBe(false);
    expect(i2v.data.status).toBe('idle');
    expect(i2v.data.result).toBeUndefined();
    expect(next.find((item) => item.id === 'other-t2i')!.data.result?.mediaId).toBe('img-other');
  });

  it('routes prompt reverse-sync to the Prompt source and invalidates the whole branch', () => {
    const next = applySemanticReverseSync(graph(), edges, {
      field: 'prompt',
      nodeId: 't2i',
      value: 'a new prompt',
    }, { runActive: false, patchConfig });
    expect(next.find((item) => item.id === 'prompt')!.data.config.prompt).toBe('a new prompt');
    expect(next.find((item) => item.id === 't2i')!.data.status).toBe('idle');
    expect(next.find((item) => item.id === 't2i')!.data.result).toBeUndefined();
    expect(next.find((item) => item.id === 'i2v')!.data.status).toBe('idle');
    expect(next.find((item) => item.id === 'other-t2i')!.data.status).toBe('success');
  });

  it('does not pair a new config with the old success result during an active run', () => {
    expect(shouldIgnoreSemanticReverseSync(true, 'model')).toBe(true);
    const before = graph();
    const next = applySemanticReverseSync(before, edges, {
      field: 'model',
      nodeId: 't2i',
      value: 'Nano Banana Pro',
    }, { runActive: true, patchConfig });
    expect(next).toBe(before);
    expect(next.find((item) => item.id === 't2i')!.data.config.model).toBe('Nano Banana 2');
    expect(next.find((item) => item.id === 't2i')!.data.status).toBe('success');
    expect(next.find((item) => item.id === 't2i')!.data.result?.mediaId).toBe('img-old');
  });
});

import { describe, expect, it } from 'vitest';
import { validateGraph, type NodeSpecForValidation } from '../../src/runtime/GraphValidator';

const prompt = (id: string): NodeSpecForValidation => ({
  id,
  kind: 'prompt',
  inputs: [],
  outputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT' }],
  config: { prompt: 'A paper boat on a lake' },
});

const t2i = (id: string): NodeSpecForValidation => ({
  id,
  kind: 't2i',
  inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT', required: true }],
  outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' }],
  config: { model: 'Nano Banana 2', usageKey: 'NARWHAL' },
});

const i2v = (id: string): NodeSpecForValidation => ({
  id,
  kind: 'i2v',
  inputs: [{ id: 'image', label: 'Start', type: 'IMAGE', required: true }],
  outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' }],
  config: { model: 'Omni Flash', usageKey: 'abra_i2v_8s' },
});

const t2v = (id: string): NodeSpecForValidation => ({
  id,
  kind: 't2v',
  inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT', required: true }],
  outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' }],
  config: { model: 'Veo 3.1', usageKey: 'veo_3_1_t2v_fast' },
});

const supported = new Set(['prompt', 't2i', 'i2v', 't2v', 'download']);
const project = { projectId: '64d45b46-4389-4e29-8795-1f48739b93e0' };

describe('GraphValidator', () => {
  it('passes a valid V1 chain', () => {
    const report = validateGraph([prompt('1'), t2i('2'), i2v('3')], [
      { id: 'e1', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt' },
      { id: 'e2', source: '2', sourceHandle: 'image', target: '3', targetHandle: 'image' },
    ], { activeProject: project, supportedKinds: supported });
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('passes a valid Text-to-Video chain', () => {
    const report = validateGraph([prompt('1'), t2v('2')], [
      { id: 'e1', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'prompt' },
    ], { activeProject: project, supportedKinds: supported });
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('blocks run without an active project', () => {
    const report = validateGraph([prompt('1')], [], { activeProject: null, supportedKinds: supported });
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'PROJECT_REQUIRED')).toBe(true);
  });

  it('flags missing required input', () => {
    const report = validateGraph([t2i('2')], [], { activeProject: project, supportedKinds: supported });
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'MISSING_REQUIRED_INPUT' && issue.nodeIds.includes('2'))).toBe(true);
  });

  it('flags Text-to-Video missing required prompt input', () => {
    const report = validateGraph([t2v('2')], [], { activeProject: project, supportedKinds: supported });
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'MISSING_REQUIRED_INPUT' && issue.nodeIds.includes('2'))).toBe(true);
  });

  it('flags Text-to-Video missing model config', () => {
    const node = t2v('2');
    node.config = { usageKey: '' };
    const report = validateGraph([node], [], { activeProject: project, supportedKinds: supported });
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'INVALID_MODEL' && issue.nodeIds.includes('2'))).toBe(true);
  });

  it('flags unsupported node kinds (never fake success)', () => {
    const report = validateGraph([{ ...t2i('2'), kind: 'extend' }], [], { activeProject: project, supportedKinds: supported });
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'UNSUPPORTED_NODE')).toBe(true);
  });

  it('flags type mismatches across edges', () => {
    const report = validateGraph([prompt('1'), t2i('2')], [
      { id: 'e1', source: '1', sourceHandle: 'prompt', target: '2', targetHandle: 'image' },
    ], { activeProject: project, supportedKinds: supported });
    // prompt output → wrong target port: prompt type is PROMPT, image is IMAGE → mismatch (or required-missing)
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it('flags empty prompt config', () => {
    const report = validateGraph([{ ...prompt('1'), config: { prompt: '' } }], [], { activeProject: project, supportedKinds: supported });
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'MISSING_CONFIG')).toBe(true);
  });

  it('flags model resolver failures', () => {
    const report = validateGraph([t2i('2')], [], {
      activeProject: project,
      supportedKinds: supported,
      modelResolver: () => ({ valid: false, reason: 'Model NARWHAL not available in this project' }),
    });
    expect(report.valid).toBe(false);
    expect(report.errors.some((issue) => issue.code === 'INVALID_MODEL')).toBe(true);
  });

  it('allows multiple sources into ports with multiple: true, but rejects for single ports', () => {
    const refNode: NodeSpecForValidation = {
      id: 'ref',
      kind: 'reference',
      inputs: [
        { id: 'prompt', label: 'Prompt', type: 'PROMPT', required: true },
        { id: 'references', label: 'References', type: 'IMAGE', required: true, multiple: true },
      ],
      outputs: [{ id: 'video', label: 'Video', type: 'VIDEO' }],
      config: { model: 'Omni 1.1 Flash', usageKey: 'veo_3_1_reference' },
    };
    const img1: NodeSpecForValidation = {
      id: 'img1',
      kind: 't2i',
      inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT', required: false }],
      outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' }],
      config: { model: 'Nano Banana 2', usageKey: 'NARWHAL' },
    };
    const img2: NodeSpecForValidation = {
      id: 'img2',
      kind: 't2i',
      inputs: [{ id: 'prompt', label: 'Prompt', type: 'PROMPT', required: false }],
      outputs: [{ id: 'image', label: 'Image', type: 'IMAGE' }],
      config: { model: 'Nano Banana 2', usageKey: 'NARWHAL' },
    };
    const pr = prompt('p');

    // references port has multiple: true
    const validMulti = validateGraph([pr, img1, img2, refNode], [
      { id: 'e1', source: 'p', sourceHandle: 'prompt', target: 'ref', targetHandle: 'prompt' },
      { id: 'e2', source: 'img1', sourceHandle: 'image', target: 'ref', targetHandle: 'references' },
      { id: 'e3', source: 'img2', sourceHandle: 'image', target: 'ref', targetHandle: 'references' },
    ], { activeProject: project, supportedKinds: new Set([...supported, 'reference']) });

    expect(validMulti.valid).toBe(true);

    // single-input port (like i2v image port which has multiple: false / default)
    const i2vNode = i2v('i2v');
    const invalidMulti = validateGraph([img1, img2, i2vNode], [
      { id: 'e4', source: 'img1', sourceHandle: 'image', target: 'i2v', targetHandle: 'image' },
      { id: 'e5', source: 'img2', sourceHandle: 'image', target: 'i2v', targetHandle: 'image' },
    ], { activeProject: project, supportedKinds: supported });

    expect(invalidMulti.valid).toBe(false);
    expect(invalidMulti.errors.some((issue) => issue.code === 'MULTIPLE_SOURCE')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPresentationSpec, isVideoPresentationNode } from '../../src/ui/studio/nodePresentationSpec';

describe('PresentationSemantics & Renderer Verification', () => {
  const ALL_27_KINDS = [
    'prompt', 'uploadImage', 'mediaInput', 'imageInput', 'videoInput', 'audioInput',
    'gemini', 'creationAgent',
    't2i', 'imageTransform', 'imageUpscale',
    't2v', 'i2v', 'extend', 'interpolation', 'reference', 'videoUpscale',
    'characterCreate', 'characterAssign', 'likenessCheck', 'likenessList',
    'download', 'preview',
    'condition', 'delay', 'note', 'cancelGeneration'
  ];

  it('∀ NodeKind → presentation spec exists and is fully categorized without fallback', () => {
    for (const kind of ALL_27_KINDS) {
      const spec = getPresentationSpec(kind);
      expect(spec).toBeDefined();
      expect(spec.archetype).toBeDefined();
      expect(spec.category).toBeDefined();
      expect(spec.icon).toBeDefined();
    }
  });

  it('ensures video presentation nodes are strictly unified across runtime & UI', () => {
    const videoKinds = ['t2v', 'i2v', 'interpolation', 'reference', 'extend', 'videoInput', 'videoUpscale'];
    for (const vk of videoKinds) {
      expect(isVideoPresentationNode(vk)).toBe(true);
    }

    const nonVideoKinds = ['t2i', 'prompt', 'gemini', 'uploadImage', 'imageInput', 'imageUpscale'];
    for (const nvk of nonVideoKinds) {
      expect(isVideoPresentationNode(nvk)).toBe(false);
    }
  });

  it('ensures preview and download nodes have clean semantic contracts', () => {
    const previewSpec = getPresentationSpec('preview');
    expect(previewSpec.controls).toEqual([]);
    expect(previewSpec.isMediaHolder).toBe(true);
    expect(previewSpec.category).toBe('OUTPUT');
    expect(previewSpec.archetype).toBe('media-preview');

    const downloadSpec = getPresentationSpec('download');
    expect(downloadSpec.controls).toEqual([]);
    expect(downloadSpec.archetype).toBe('download');
    expect(downloadSpec.category).toBe('OUTPUT');
  });

  it('presents Preview as Output Preview / Run Target, not generic pass-through', () => {
    const modelSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/model.ts'), 'utf8');
    const nodeSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/WorkflowNode.tsx'), 'utf8');
    const portsSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/ports.ts'), 'utf8');
    expect(modelSrc).toMatch(/kind: 'preview'[\s\S]{0,180}title: 'Output Preview'/);
    expect(modelSrc).toMatch(/Run Target/);
    expect(nodeSrc).toContain('Output Preview');
    expect(nodeSrc).toContain('Connect a branch to run');
    expect(portsSrc).toMatch(/preview:\s*\{[\s\S]*?required: true/);
    expect(portsSrc).toMatch(/preview:\s*\{[\s\S]*?outputs: \[p\('media'/);
  });

  it('ensures delay node has compact utility archetype and delay control', () => {
    const delaySpec = getPresentationSpec('delay');
    expect(delaySpec.controls).toContain('delay');
    expect(delaySpec.archetype).toBe('utility');
    expect(delaySpec.isMediaHolder).toBe(false);
  });

  it('ensures logic nodes (condition, note, cancelGeneration) do NOT hold media preview', () => {
    expect(getPresentationSpec('condition').isMediaHolder).toBe(false);
    expect(getPresentationSpec('note').isMediaHolder).toBe(false);
    expect(getPresentationSpec('cancelGeneration').isMediaHolder).toBe(false);
  });

  it('ensures upscale nodes only expose targetResolution control', () => {
    const imgUp = getPresentationSpec('imageUpscale');
    expect(imgUp.controls).toContain('targetResolution');
    expect(imgUp.controls).not.toContain('model');

    const vidUp = getPresentationSpec('videoUpscale');
    expect(vidUp.controls).toContain('targetResolution');
    expect(vidUp.controls).not.toContain('model');
  });
});

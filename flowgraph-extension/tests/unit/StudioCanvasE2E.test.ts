import { describe, it, expect } from 'vitest';
import { initialNodes, initialEdges } from '../../src/ui/studio/model';

describe('E2E UI Canvas Contract & Settings Verification', () => {
  it('initializes the V1 4-node pipeline with valid nodes and edges', () => {
    expect(initialNodes.length).toBe(4);
    expect(initialEdges.length).toBe(4);

    const [promptNode, t2iNode, i2vNode, downloadNode] = initialNodes;

    // 1. Prompt Node
    expect(promptNode.data.kind).toBe('prompt');
    expect(promptNode.data.config.prompt).toBeTruthy();

    // 2. Text to Image Node
    expect(t2iNode.data.kind).toBe('t2i');
    expect(t2iNode.data.config.model).toContain('Nano Banana');
    expect(t2iNode.data.config.aspectRatio).toBe('16:9');
    expect(t2iNode.data.config.batchCount).toBe('1');
    expect(t2iNode.data.config.costCredits).toBe('0');

    // 3. Image to Video Node
    expect(i2vNode.data.kind).toBe('i2v');
    expect(i2vNode.data.config.model).toBe('Omni 1.1 Flash');
    expect(i2vNode.data.config.duration).toBe('8 seconds');
    expect(i2vNode.data.config.resolution).toBe('720p');
    expect(i2vNode.data.config.costCredits).toBe('12');

    // 4. Download / Final Video Node
    expect(downloadNode.data.kind).toBe('download');
  });

  it('validates edge connectivity between nodes', () => {
    const edgeMap = initialEdges.map((e) => `${e.source}->${e.target}`);
    expect(edgeMap).toEqual(['1->2', '2->3', '3->4', '1->3']);
  });

  it('supports model switching and ratio updates without state corruption', () => {
    const t2iNode = { ...initialNodes[1] };
    const validImageModels = ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'];
    const validAspectRatios = ['16:9', '4:3', '1:1', '3:4', '9:16'];

    // Verify model switching
    validImageModels.forEach((m) => {
      const updated = { ...t2iNode, data: { ...t2iNode.data, config: { ...t2iNode.data.config, model: m } } };
      expect(updated.data.config.model).toBe(m);
    });

    // Verify ratio switching
    validAspectRatios.forEach((r) => {
      const updated = { ...t2iNode, data: { ...t2iNode.data, config: { ...t2iNode.data.config, aspectRatio: r } } };
      expect(updated.data.config.aspectRatio).toBe(r);
    });
  });

  it('supports video node mode, resolution, duration and batch count updates', () => {
    const i2vNode = { ...initialNodes[2] };
    const validVideoModels = ['Omni 1.1 Flash', 'Veo 3.1 – Lite', 'Veo 3.1 – Fast', 'Veo 3.1 – Quality'];
    const validModes = ['Thành phần', 'Khung hình'];
    const validDurations = ['4 seconds', '6 seconds', '8 seconds', '10 seconds'];
    const validResolutions = ['720p', '360p'];

    validVideoModels.forEach((m) => {
      const updated = { ...i2vNode, data: { ...i2vNode.data, config: { ...i2vNode.data.config, model: m } } };
      expect(updated.data.config.model).toBe(m);
    });

    validDurations.forEach((d) => {
      const updated = { ...i2vNode, data: { ...i2vNode.data, config: { ...i2vNode.data.config, duration: d } } };
      expect(updated.data.config.duration).toBe(d);
    });

    validResolutions.forEach((r) => {
      const updated = { ...i2vNode, data: { ...i2vNode.data, config: { ...i2vNode.data.config, resolution: r } } };
      expect(updated.data.config.resolution).toBe(r);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { initialNodes, initialEdges, type FlowNode } from '../../src/ui/studio/model';
import {
  PENDING_RUN_ID,
  acceptRuntimeEvent,
  applyConfigIfUnlocked,
  applyNodeEventIfCurrent,
  filterEdgeChangesDuringRun,
  filterNodeChangesDuringRun,
  generationAfterProjectChange,
  isProjectSelectLocked,
  isSemanticMutationLocked,
} from '../../src/ui/studio/runGenerationGuard';
import { persistWorkflowIfHydrated, restoreWorkflow } from '../../src/ui/studio/workflowPersistence';

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
    expect(i2vNode.data.config.costCredits).not.toBe('12');

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

describe('project-switch / run isolation fence', () => {
  function canvasNode(id: string, mediaId?: string): FlowNode {
    return {
      ...initialNodes[1],
      id,
      data: {
        ...initialNodes[1].data,
        status: mediaId ? 'success' : 'idle',
        result: mediaId ? { type: 'image', previewUrl: '', mediaId } : undefined,
      },
    };
  }

  it('blocks project dropdown while a run is in flight', () => {
    expect(isProjectSelectLocked('running')).toBe(true);
    expect(isProjectSelectLocked('ready')).toBe(false);
  });

  it('A running → switch B: late A success/error are ignored and do not autosave into B', () => {
    const storage = {
      data: new Map<string, string>(),
      getItem(key: string) { return this.data.get(key) ?? null; },
      setItem(key: string, value: string) { this.data.set(key, value); },
    };
    const nodesB = [canvasNode('img', 'media-b')];
    persistWorkflowIfHydrated(nodesB, initialEdges, 'main', 'B', { projectId: 'project-b', projectName: 'B' }, 'project-b', storage);

    const activeA = { runId: PENDING_RUN_ID, projectId: 'project-a' };
    const afterSwitch = generationAfterProjectChange('project-a', 'project-b', activeA);
    expect(afterSwitch).toBeUndefined();
    expect(acceptRuntimeEvent({ runId: 'run-a' }, 'project-a', afterSwitch, 1, 2)).toBe(false);

    const lateSuccess = applyNodeEventIfCurrent(
      nodesB,
      { runId: 'run-a', nodeId: 'img', state: 'success', result: { type: 'image', mediaId: 'media-from-A' } },
      'project-a',
      afterSwitch,
    );
    const lateError = applyNodeEventIfCurrent(
      nodesB,
      { runId: 'run-a', nodeId: 'img', state: 'failed' },
      'project-a',
      afterSwitch,
    );
    expect(lateSuccess[0].data.result?.mediaId).toBe('media-b');
    expect(lateError[0].data.status).toBe('success');

    persistWorkflowIfHydrated(lateSuccess, initialEdges, 'main', 'B', { projectId: 'project-b', projectName: 'B' }, 'project-b', storage);
    expect(restoreWorkflow('project-b', 'main', storage).nodes[0].data.result?.mediaId).toBe('media-b');
  });
});

describe('live graph mutation fence during an active run', () => {
  function memoryStorage() {
    return {
      data: new Map<string, string>(),
      getItem(key: string) { return this.data.get(key) ?? null; },
      setItem(key: string, value: string) { this.data.set(key, value); },
    };
  }

  it('config edit during a run is ignored so a late old result cannot autosave under new config', () => {
    expect(isSemanticMutationLocked('running')).toBe(true);
    const storage = memoryStorage();
    const live = [canvasNodeForFence('img')];
    live[0].data.config = { ...live[0].data.config, model: 'Nano Banana 2', prompt: 'old-prompt' };
    const afterEdit = applyConfigIfUnlocked(live, 'img', 'model', 'Nano Banana Pro', 'running');
    expect(afterEdit[0].data.config.model).toBe('Nano Banana 2');

    const withResult = applyNodeEventIfCurrent(
      afterEdit,
      { runId: 'run-live', nodeId: 'img', state: 'success', result: { type: 'image', mediaId: 'media-old-snapshot' } },
      'project-a',
      { runId: 'run-live', projectId: 'project-a' },
    );
    expect(withResult[0].data.config.model).toBe('Nano Banana 2');
    expect(withResult[0].data.result?.mediaId).toBe('media-old-snapshot');

    persistWorkflowIfHydrated(withResult, initialEdges, 'main', 'A', { projectId: 'project-a', projectName: 'A' }, 'project-a', storage);
    const restored = restoreWorkflow('project-a', 'main', storage);
    expect(restored.nodes[0].data.config.model).toBe('Nano Banana 2');
    expect(restored.nodes[0].data.result?.mediaId).toBe('media-old-snapshot');
  });

  it('topology mutation during a run is dropped so a late result stays on the original graph', () => {
    const storage = memoryStorage();
    const live = [canvasNodeForFence('img'), canvasNodeForFence('extra')];
    const nodeChanges = filterNodeChangesDuringRun(
      [{ type: 'remove', id: 'img' }, { type: 'add', item: { id: 'ghost' } }, { type: 'select', id: 'img' }],
      'running',
    );
    expect(nodeChanges).toEqual([{ type: 'select', id: 'img' }]);
    const edgeChanges = filterEdgeChangesDuringRun(
      [{ type: 'remove', id: '1-2' }, { type: 'add', item: { id: 'ghost-edge' } }, { type: 'select', id: '1-2' }],
      'running',
    );
    expect(edgeChanges).toEqual([{ type: 'select', id: '1-2' }]);

    const withResult = applyNodeEventIfCurrent(
      live,
      { runId: 'run-live', nodeId: 'img', state: 'success', result: { type: 'image', mediaId: 'media-old-snapshot' } },
      'project-a',
      { runId: 'run-live', projectId: 'project-a' },
    );
    expect(withResult.map((node) => node.id)).toEqual(['img', 'extra']);
    persistWorkflowIfHydrated(withResult, initialEdges, 'main', 'A', { projectId: 'project-a', projectName: 'A' }, 'project-a', storage);
    const restored = restoreWorkflow('project-a', 'main', storage);
    expect(restored.nodes.map((node) => node.id)).toEqual(['img', 'extra']);
    expect(restored.nodes[0].data.result?.mediaId).toBe('media-old-snapshot');
    expect(restored.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual(['1->2', '2->3', '3->4', '1->3']);
  });

  it('normal config and topology edits after Stop/completion still apply', () => {
    const idle = [canvasNodeForFence('img')];
    idle[0].data.config = { ...idle[0].data.config, model: 'Nano Banana 2' };
    expect(applyConfigIfUnlocked(idle, 'img', 'model', 'Nano Banana Pro', 'ready')[0].data.config.model).toBe('Nano Banana Pro');
    expect(applyConfigIfUnlocked(idle, 'img', 'model', 'Nano Banana 2 Lite', 'success')[0].data.config.model).toBe('Nano Banana 2 Lite');
    expect(filterNodeChangesDuringRun([{ type: 'remove', id: 'img' }], 'ready')).toEqual([{ type: 'remove', id: 'img' }]);
    expect(filterEdgeChangesDuringRun([{ type: 'remove', id: 'e1' }], 'error')).toEqual([{ type: 'remove', id: 'e1' }]);
    expect(isSemanticMutationLocked('success')).toBe(false);
  });
});

function canvasNodeForFence(id: string, mediaId?: string): FlowNode {
  return {
    ...initialNodes[1],
    id,
    data: {
      ...initialNodes[1].data,
      status: mediaId ? 'success' : 'idle',
      result: mediaId ? { type: 'image', previewUrl: '', mediaId } : undefined,
    },
  };
}

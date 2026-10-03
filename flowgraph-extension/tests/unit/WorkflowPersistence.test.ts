import { describe, expect, it } from 'vitest';
import { cloneInitialNodes, initialEdges } from '../../src/ui/studio/model';
import {
  LEGACY_WORKFLOW_KEY,
  WORKFLOW_SCHEMA_VERSION,
  buildSavedWorkflow,
  persistWorkflow,
  persistWorkflowIfHydrated,
  readSavedWorkflow,
  resolveHydratedProjectId,
  restoreWorkflow,
  shouldPersistToProject,
  workflowStorageKey,
} from '../../src/ui/studio/workflowPersistence';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function projectNode(title: string, mediaId: string, nodeId: string) {
  const nodes = cloneInitialNodes();
  nodes[0] = {
    ...nodes[0],
    id: nodeId,
    data: {
      ...nodes[0].data,
      title,
      result: { type: 'image', previewUrl: '', mediaId, mimeType: 'image/png' },
    },
  };
  return nodes;
}

describe('Film workflow persistence — project/shot isolation', () => {
  it('namespaces storage by both projectId and workflowId', () => {
    expect(workflowStorageKey('project-a', 'workflow-shot-001')).not.toBe(
      workflowStorageKey('project-a', 'workflow-shot-002'),
    );
    expect(workflowStorageKey('project-a', 'workflow-shot-001')).not.toBe(
      workflowStorageKey('project-b', 'workflow-shot-001'),
    );
  });

  it('never persists transient preview URLs while retaining stable media metadata', () => {
    const nodes = cloneInitialNodes();
    nodes[0] = {
      ...nodes[0],
      data: {
        ...nodes[0].data,
        result: {
          type: 'image',
          previewUrl: 'https://signed.example/media?token=secret',
          mediaId: 'media-stable-001',
          mimeType: 'image/png',
          fileName: 'frame.png',
        },
      },
    };

    const saved = buildSavedWorkflow(
      nodes,
      initialEdges,
      'workflow-shot-001',
      'Shot 001',
      { projectId: 'project-a', projectName: 'Project A' },
    );

    expect(saved.nodes[0].data.result?.previewUrl).toBe('');
    expect(saved.runtimeResults?.[nodes[0].id]).toEqual({
      type: 'image',
      mediaId: 'media-stable-001',
      mimeType: 'image/png',
      fileName: 'frame.png',
    });
  });

  it('persists trusted provider projectId and strips signed preview URLs', () => {
    const nodes = cloneInitialNodes();
    nodes[0] = {
      ...nodes[0],
      data: {
        ...nodes[0].data,
        result: {
          type: 'image',
          previewUrl: 'https://signed.example/media?token=secret',
          mediaId: 'media-stable-002',
          mimeType: 'image/png',
          projectId: 'project-a',
        },
      },
    };
    const saved = buildSavedWorkflow(
      nodes,
      initialEdges,
      'workflow-shot-002',
      'Shot 002',
      { projectId: 'project-a', projectName: 'Project A' },
    );
    expect(saved.nodes[0].data.result?.previewUrl).toBe('');
    expect(saved.nodes[0].data.result?.projectId).toBe('project-a');
    expect(saved.runtimeResults?.[nodes[0].id]?.projectId).toBe('project-a');
    expect(saved.runtimeResults?.[nodes[0].id]?.mediaId).toBe('media-stable-002');
  });

  it('restores distinct graphs for distinct shots in the same project', () => {
    const storage = new MemoryStorage();
    const nodesA = cloneInitialNodes();
    const nodesB = cloneInitialNodes();
    nodesA[0] = { ...nodesA[0], data: { ...nodesA[0].data, title: 'Shot A Prompt' } };
    nodesB[0] = { ...nodesB[0], data: { ...nodesB[0].data, title: 'Shot B Prompt' } };

    persistWorkflow(nodesA, initialEdges, 'workflow-shot-a', 'Shot A', { projectId: 'project-a', projectName: 'A' }, storage);
    persistWorkflow(nodesB, initialEdges, 'workflow-shot-b', 'Shot B', { projectId: 'project-a', projectName: 'A' }, storage);

    expect(restoreWorkflow('project-a', 'workflow-shot-a', storage).nodes[0].data.title).toBe('Shot A Prompt');
    expect(restoreWorkflow('project-a', 'workflow-shot-b', storage).nodes[0].data.title).toBe('Shot B Prompt');
    expect(readSavedWorkflow('project-b', 'workflow-shot-a', storage)).toBeUndefined();
  });

  it('migrates the legacy global graph only when its project binding matches', () => {
    const storage = new MemoryStorage();
    const legacy = {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      name: 'Legacy Main',
      savedAt: new Date().toISOString(),
      nodes: cloneInitialNodes(),
      edges: initialEdges,
      projectBinding: { projectId: 'project-a', projectName: 'A' },
    };
    storage.setItem(LEGACY_WORKFLOW_KEY, JSON.stringify(legacy));

    expect(readSavedWorkflow('project-b', 'main', storage)).toBeUndefined();
    expect(readSavedWorkflow('project-a', 'main', storage)?.workflowId).toBe('main');
    expect(storage.getItem(workflowStorageKey('project-a', 'main'))).not.toBeNull();
  });

  it('does not persist until the canvas is hydrated for the same project', () => {
    expect(resolveHydratedProjectId('project-b', 'project-a')).toBeUndefined();
    expect(resolveHydratedProjectId('project-b', undefined)).toBeUndefined();
    expect(resolveHydratedProjectId(undefined, 'project-b')).toBeUndefined();
    expect(resolveHydratedProjectId('project-b', 'project-b')).toBe('project-b');
    expect(shouldPersistToProject('project-b', 'project-a')).toBe(false);
    expect(shouldPersistToProject('project-b', undefined)).toBe(false);
    expect(shouldPersistToProject('project-b', 'project-b')).toBe(true);
  });

  it('A→B binding flip does not clobber B before load; A↔B roundtrip keeps runtimeResults', () => {
    const storage = new MemoryStorage();
    const nodesA = projectNode('Project A Hero', 'media-a', 'a-t2i');
    const nodesB = projectNode('Project B Hero', 'media-b', 'b-t2i');
    const bindingA = { projectId: 'project-a', projectName: 'A' };
    const bindingB = { projectId: 'project-b', projectName: 'B' };

    persistWorkflow(nodesA, initialEdges, 'main', 'A', bindingA, storage);
    persistWorkflow(nodesB, initialEdges, 'main', 'B', bindingB, storage);
    const bBefore = storage.getItem(workflowStorageKey('project-b', 'main'));
    const aBefore = storage.getItem(workflowStorageKey('project-a', 'main'));

    // React paints new binding B while canvas + hydrated id are still A.
    const wroteDuringFlip = persistWorkflowIfHydrated(
      nodesA,
      initialEdges,
      'main',
      'A',
      bindingB,
      resolveHydratedProjectId('project-b', 'project-a'),
      storage,
    );
    expect(wroteDuringFlip).toBe(false);
    expect(storage.getItem(workflowStorageKey('project-b', 'main'))).toBe(bBefore);

    // After render-time invalidation, hydrated is undefined until restore.
    expect(persistWorkflowIfHydrated(nodesA, initialEdges, 'main', 'A', bindingB, undefined, storage)).toBe(false);
    expect(storage.getItem(workflowStorageKey('project-b', 'main'))).toBe(bBefore);

    const restoredB = restoreWorkflow('project-b', 'main', storage);
    expect(restoredB.nodes[0].data.title).toBe('Project B Hero');
    expect(restoredB.nodes[0].data.result?.mediaId).toBe('media-b');
    expect(restoredB.nodes[0].data.status).toBe('success');

    // Normal autosave after B is on the canvas.
    expect(persistWorkflowIfHydrated(
      restoredB.nodes,
      restoredB.edges,
      'main',
      restoredB.name ?? 'B',
      bindingB,
      'project-b',
      storage,
    )).toBe(true);

    // Switch back: binding A, canvas still B, hydrated still B.
    expect(persistWorkflowIfHydrated(
      restoredB.nodes,
      restoredB.edges,
      'main',
      restoredB.name ?? 'B',
      bindingA,
      resolveHydratedProjectId('project-a', 'project-b'),
      storage,
    )).toBe(false);
    expect(storage.getItem(workflowStorageKey('project-a', 'main'))).toBe(aBefore);

    const restoredA = restoreWorkflow('project-a', 'main', storage);
    expect(restoredA.nodes[0].data.title).toBe('Project A Hero');
    expect(restoredA.nodes[0].data.result?.mediaId).toBe('media-a');
    expect(restoredA.nodes[0].data.status).toBe('success');
    expect(restoreWorkflow('project-b', 'main', storage).nodes[0].data.title).toBe('Project B Hero');
  });

  it('blank project B does not inherit project A canvas during the A→B flip', () => {
    const storage = new MemoryStorage();
    const nodesA = projectNode('Project A Hero', 'media-a', 'a-t2i');
    const bindingA = { projectId: 'project-a', projectName: 'A' };
    const bindingB = { projectId: 'project-b', projectName: 'B' };

    persistWorkflow(nodesA, initialEdges, 'main', 'A', bindingA, storage);

    expect(persistWorkflowIfHydrated(
      nodesA,
      initialEdges,
      'main',
      'A',
      bindingB,
      resolveHydratedProjectId('project-b', 'project-a'),
      storage,
    )).toBe(false);

    expect(readSavedWorkflow('project-b', 'main', storage)).toBeUndefined();
    const restoredB = restoreWorkflow('project-b', 'main', storage);
    expect(restoredB.nodes).toEqual([]);
    expect(restoredB.edges).toEqual([]);
    expect(restoreWorkflow('project-a', 'main', storage).nodes[0].data.title).toBe('Project A Hero');
  });
});

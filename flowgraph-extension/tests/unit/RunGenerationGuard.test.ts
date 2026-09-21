import { describe, expect, it } from 'vitest';
import { computeRunBlockReason, type RunBlockReason } from '../../src/ui/studio/useStudioConnection';
import type { AccountStatus, FlowStatus } from '../../src/shared/bridge';
import {
  PENDING_RUN_ID,
  acceptRuntimeEvent,
  applyConfigIfUnlocked,
  applyNodeEventIfCurrent,
  belongsToActiveGeneration,
  filterEdgeChangesDuringRun,
  filterNodeChangesDuringRun,
  generationAfterProjectChange,
  isLiveRun,
  isProjectSelectLocked,
  isSemanticMutationLocked,
} from '../../src/ui/studio/runGenerationGuard';
import { persistWorkflowIfHydrated, workflowStorageKey } from '../../src/ui/studio/workflowPersistence';
import type { FlowNode } from '../../src/ui/studio/model';

function node(id: string, result?: { mediaId: string; type: 'image' }): FlowNode {
  return {
    id,
    type: 'flowNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 't2i',
      title: id,
      subtitle: '',
      tone: 'blue',
      status: result ? 'success' : 'idle',
      config: { model: 'Nano Banana 2' },
      result: result ? { type: result.type, previewUrl: '', mediaId: result.mediaId } : undefined,
      maturity: 'RUNTIME_VERIFIED',
      capabilityLabel: '',
      capabilitySummary: '',
    },
  };
}

describe('run generation / project-switch fence', () => {
  it('locks project select/create only while a run is in flight', () => {
    expect(isProjectSelectLocked('running')).toBe(true);
    expect(isProjectSelectLocked('ready')).toBe(false);
    expect(isProjectSelectLocked('success')).toBe(false);
    expect(isProjectSelectLocked('error')).toBe(false);
  });

  it('rejects late events from project A after the live generation is project B', () => {
    const activeB = { runId: 'run-b', projectId: 'project-b' };
    expect(belongsToActiveGeneration({ runId: 'run-a' }, 'project-a', activeB)).toBe(false);
    expect(belongsToActiveGeneration({ runId: 'run-b' }, 'project-b', activeB)).toBe(true);
    expect(belongsToActiveGeneration({ runId: 'run-b' }, 'project-b', undefined)).toBe(false);
  });

  it('clears the live generation token on project change so late success cannot land', () => {
    const activeA = { runId: 'run-a', projectId: 'project-a' };
    expect(generationAfterProjectChange('project-a', 'project-b', activeA)).toBeUndefined();
    expect(generationAfterProjectChange('project-a', 'project-a', activeA)).toEqual(activeA);
  });

  it('does not write run A success onto project B nodes, so autosave B stays clean', () => {
    const storage = {
      data: new Map<string, string>(),
      getItem(key: string) { return this.data.get(key) ?? null; },
      setItem(key: string, value: string) { this.data.set(key, value); },
    };
    const nodesB = [node('img')];
    const late = applyNodeEventIfCurrent(
      nodesB,
      { runId: 'run-a', nodeId: 'img', state: 'success', result: { type: 'image', mediaId: 'media-from-A' } },
      'project-a',
      undefined,
    );
    expect(late).toBe(nodesB);
    expect(late[0].data.result).toBeUndefined();

    persistWorkflowIfHydrated(
      late,
      [],
      'main',
      'B',
      { projectId: 'project-b', projectName: 'B' },
      'project-b',
      storage,
    );
    const saved = JSON.parse(storage.getItem(workflowStorageKey('project-b', 'main')) ?? '{}');
    expect(saved.runtimeResults?.img).toBeUndefined();
    expect(saved.nodes?.[0]?.data?.result?.mediaId).toBeUndefined();
  });

  it('does not write run A error onto project B nodes', () => {
    const nodesB = [node('img')];
    const late = applyNodeEventIfCurrent(
      nodesB,
      { runId: 'run-a', nodeId: 'img', state: 'failed' },
      'project-a',
      undefined,
    );
    expect(late).toBe(nodesB);
    expect(late[0].data.status).toBe('idle');
  });

  it('still applies events for the live run on the same project', () => {
    const active = { runId: 'run-a', projectId: 'project-a' };
    const nodes = [node('img')];
    const next = applyNodeEventIfCurrent(
      nodes,
      { runId: 'run-a', nodeId: 'img', state: 'success', result: { type: 'image', mediaId: 'media-ok' } },
      'project-a',
      active,
    );
    expect(next[0].data.result).toEqual({ type: 'image', mediaId: 'media-ok' });
    expect(next[0].data.status).toBe('success');
  });

  it('epoch bump after A→B switch ignores pending bind of late A events', () => {
    const pendingA = { runId: PENDING_RUN_ID, projectId: 'project-a' };
    expect(acceptRuntimeEvent({ runId: 'run-a' }, 'project-a', pendingA, 1, 1)).toBe(true);
    expect(acceptRuntimeEvent({ runId: 'run-a' }, 'project-a', pendingA, 1, 2)).toBe(false);
    expect(acceptRuntimeEvent({ runId: 'run-a' }, 'project-a', undefined, 1, 2)).toBe(false);
    expect(isLiveRun(1, 2, pendingA, 'project-a')).toBe(false);
    expect(isLiveRun(1, 1, pendingA, 'project-a')).toBe(true);
  });

  it('blocks config and topology mutations during a run so a late result cannot pair with a new graph', () => {
    const running: FlowNode[] = [node('img')];
    const blocked = applyConfigIfUnlocked(running, 'img', 'model', 'Nano Banana Pro', 'running');
    expect(blocked).toBe(running);
    expect(blocked[0].data.config.model).toBe('Nano Banana 2');

    const late = applyNodeEventIfCurrent(
      blocked,
      { runId: 'run-a', nodeId: 'img', state: 'success', result: { type: 'image', mediaId: 'media-old-run' } },
      'project-a',
      { runId: 'run-a', projectId: 'project-a' },
    );
    expect(late[0].data.config.model).toBe('Nano Banana 2');
    expect(late[0].data.result).toEqual({ type: 'image', mediaId: 'media-old-run' });

    expect(filterEdgeChangesDuringRun(
      [{ type: 'remove', id: 'e1' }, { type: 'select', id: 'e1' }],
      'running',
    )).toEqual([{ type: 'select', id: 'e1' }]);
    expect(filterNodeChangesDuringRun(
      [{ type: 'remove', id: 'img' }, { type: 'position', id: 'img' }],
      'running',
    )).toEqual([{ type: 'position', id: 'img' }]);
    expect(isSemanticMutationLocked('running')).toBe(true);
    expect(isSemanticMutationLocked('ready')).toBe(false);

    const storage = {
      data: new Map<string, string>(),
      getItem(key: string) { return this.data.get(key) ?? null; },
      setItem(key: string, value: string) { this.data.set(key, value); },
    };
    persistWorkflowIfHydrated(
      late,
      [],
      'main',
      'A',
      { projectId: 'project-a', projectName: 'A' },
      'project-a',
      storage,
    );
    const saved = JSON.parse(storage.getItem(workflowStorageKey('project-a', 'main')) ?? '{}');
    expect(saved.nodes?.[0]?.data?.config?.model).toBe('Nano Banana 2');
    expect(saved.runtimeResults?.img?.mediaId).toBe('media-old-run');
  });

  it('Stop/completion then edit cannot receive a cancelled run result', () => {
    const idle = [node('img')];
    expect(acceptRuntimeEvent({ runId: 'run-a' }, 'project-a', undefined, 1, 2)).toBe(false);
    const edited = applyConfigIfUnlocked(idle, 'img', 'model', 'Nano Banana Pro', 'ready');
    expect(edited[0].data.config.model).toBe('Nano Banana Pro');
    const late = applyNodeEventIfCurrent(
      edited,
      { runId: 'run-a', nodeId: 'img', state: 'success', result: { type: 'image', mediaId: 'stale-run' } },
      'project-a',
      undefined,
    );
    expect(late[0].data.config.model).toBe('Nano Banana Pro');
    expect(late[0].data.result).toBeUndefined();
  });

  it('allows config edits after Stop/completion', () => {
    const idle = [node('img')];
    const next = applyConfigIfUnlocked(idle, 'img', 'model', 'Nano Banana Pro', 'ready');
    expect(next[0].data.config.model).toBe('Nano Banana Pro');
    const afterSuccess = applyConfigIfUnlocked(next, 'img', 'model', 'Nano Banana 2 Lite', 'success');
    expect(afterSuccess[0].data.config.model).toBe('Nano Banana 2 Lite');
  });
});

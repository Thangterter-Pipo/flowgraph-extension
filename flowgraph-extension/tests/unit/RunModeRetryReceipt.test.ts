import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as runMode from '../../src/ui/studio/workflowRunMode';
import { hydrateNodeData, paletteSpecForKind, type FlowNode } from '../../src/ui/studio/model';
import { portsForKind } from '../../src/ui/studio/ports';
import { acceptRuntimeEvent, isLiveRun, PENDING_RUN_ID } from '../../src/ui/studio/runGenerationGuard';
import { persistWorkflow, restoreWorkflow } from '../../src/ui/studio/workflowPersistence';

const source = readFileSync(new URL('../../src/ui/studio/main.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const retryFailedNode = useCallback(');
const end = source.indexOf('\n  useEffect(', start);
const callback = ts.transpileModule(`${source.slice(start, end)}; return retryFailedNode;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

describe('main retry receipt integration', () => {
  it('persists exact retry and resumed outputs with start signatures, then Continue reuses both', async () => {
    let nodes: FlowNode[] = ['t2i', 'preview'].map((kind, i) => ({
      id: String(i), type: 'flowNode', position: { x: 0, y: 0 },
      data: { ...hydrateNodeData(paletteSpecForKind(kind)!), kind, status: 'failed', config: { prompt: 'boat' } },
    }));
    const edges = [{ id: 'e', source: '0', sourceHandle: 'image', target: '1', targetHandle: 'media' }];
    const signatures = runMode.runNodeSignatures(nodes, edges, 'p');
    const media = { provider: 'GOOGLE_FLOW', type: 'IMAGE', mediaId: 'exact-provider-id', projectId: 'p', previewUrl: 'https://transient.invalid', uri: 'blob:gone' };
    const outputs = [{ image: { type: 'image', value: media } }, { media: { type: 'image', value: media } }];
    const generate = vi.fn();
    const retryNode = vi.fn(async (_id, _specs, _edges, _opts, emit) => {
      generate(); // Offline boundary spy: never calls a provider.
      outputs.forEach((out, i) => emit({ type: 'node', nodeId: String(i), state: 'success', runId: 'retry-1', projectId: 'p', outputs: out,
        result: { type: 'image', mediaId: 'lossy-ui-result', previewUrl: '' } }));
      emit({ type: 'run', state: 'success', runId: 'retry-1', projectId: 'p' });
    });
    const env = {
      ...runMode, useCallback: (fn: unknown) => fn, nodes, edges, portsForKind,
      connection: { isCanvasUnlocked: true, activeProject: { projectId: 'p' } },
      runEpochRef: { current: 0 }, runGenerationRef: { current: undefined }, PENDING_RUN_ID,
      acceptRuntimeEvent, isLiveRun, setRunStatus: vi.fn(), setElapsed: vi.fn(),
      timerRef: { current: undefined }, window: { setInterval: vi.fn(), clearInterval: vi.fn() },
      runtime: () => ({ retryNode }), activeWorkflowId: 'w',
      updateStatus: (id: string, status: any) => { nodes = nodes.map(n => n.id === id ? { ...n, data: { ...n.data, status } } : n); },
      applyResult: vi.fn(), applyError: vi.fn(),
      setNodes: (update: (current: FlowNode[]) => FlowNode[]) => { nodes = update(nodes); },
    };
    await new Function(...Object.keys(env), callback)(...Object.values(env))('0');
    expect(retryNode).toHaveBeenCalledOnce();
    nodes.forEach((n, i) => expect(n.data.runReceipt).toEqual({ signature: signatures.get(n.id), outputs: {
      [i === 0 ? 'image' : 'media']: { type: 'image', value: { provider: 'GOOGLE_FLOW', type: 'IMAGE', mediaId: 'exact-provider-id', projectId: 'p' } },
    } }));
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    persistWorkflow(nodes, edges, 'w', 'Retry', { projectId: 'p', projectName: 'P' }, storage);
    const restored = restoreWorkflow('p', 'w', storage);
    const plan = runMode.buildRunModePlan('continue', restored.nodes, restored.edges, 'p');
    expect(plan.blocked).toEqual([]);
    expect(plan.run).toEqual([]);
    expect(plan.reuse).toEqual(['0', '1']);
    expect(generate).toHaveBeenCalledOnce();
    expect(JSON.stringify([...values.values()])).not.toMatch(/transient.invalid|blob:gone/);
  });
});

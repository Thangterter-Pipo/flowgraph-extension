import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { buildRunModePlan } from '../../src/ui/studio/workflowRunMode';
import { computeRunBlockReason } from '../../src/ui/studio/useStudioConnection';
import { hydrateNodeData, paletteSpecForKind } from '../../src/ui/studio/model';

// Execute the actual main callback up to the provider preflight boundary.
// The boundary spies deliberately replace all subsequent runtime/provider work.
const source = readFileSync(new URL('../../src/ui/studio/main.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const runWorkflow = useCallback(');
const end = source.indexOf('    // Generation nodes sync preflight:', start);
const callback = ts.transpileModule(`${source.slice(start, end)}
  await runtime.run(); await provider.generate();
  } finally { runStartingRef.current = false; }
}); return runWorkflow;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness(connectionOverrides: Record<string, unknown> = {}) {
  const nodes = [{ id: 'legacy', type: 'flowNode', position: { x: 0, y: 0 },
    data: { ...hydrateNodeData(paletteSpecForKind('t2i')!), status: 'success', config: { prompt: 'boat' } } },
  { id: 'pending', type: 'flowNode', position: { x: 0, y: 0 },
    data: { ...hydrateNodeData(paletteSpecForKind('t2i')!), status: 'idle', config: { prompt: 'boat' } } }];
  const env = {
    useCallback: (fn: unknown) => fn, runStatus: 'ready', runStartingRef: { current: false },
    connection: { isCanvasUnlocked: true, runBlockReason: null, activeProject: { projectId: 'p' },
      account: { state: 'CONNECTED' }, flow: { state: 'CONNECTED', url: 'https://flow.google.com/project/p', projectId: 'p' },
      refreshAccount: vi.fn(), refreshFlow: vi.fn(), ...connectionOverrides },
    setRunMenuOpen: vi.fn(), setRunFeedback: vi.fn(), setRunError: vi.fn(), setRunStatus: vi.fn(),
    setValidationIssues: vi.fn(), validate: () => ({ valid: true, errors: [], warnings: [] }),
    nodes, edges: [], buildRunModePlan, computeRunBlockReason,
    settings: { skipExperimentalPrompt: true }, localStorage: { getItem: () => null }, window: {},
    pendingRunModeRef: { current: 'continue' }, setExperimentalGate: vi.fn(), setConfirmRerun: vi.fn(),
    runtime: { run: vi.fn() }, provider: { generate: vi.fn() },
  };
  const run = new Function(...Object.keys(env), callback)(...Object.values(env));
  return { ...env, run };
}

describe('main run-mode gate guard', () => {
  it('runs Continue through an unlocked gate: receipt-less success nodes are auto-upgraded into the plan', async () => {
    const h = harness();
    const before = JSON.stringify(h.nodes);
    await h.run();
    expect(h.runtime.run).toHaveBeenCalledOnce();
    expect(h.provider.generate).toHaveBeenCalledOnce();
    expect(h.setRunError).not.toHaveBeenCalled();
    expect(h.setRunStatus).not.toHaveBeenCalledWith('error');
    // Gate was never locked, so the bounded health reconciliation must not run.
    expect(h.connection.refreshAccount).not.toHaveBeenCalled();
    expect(h.connection.refreshFlow).not.toHaveBeenCalled();
    expect(h.setConfirmRerun).not.toHaveBeenCalled();
    expect(h.runStartingRef.current).toBe(false);
    expect(JSON.stringify(h.nodes)).toBe(before);
  });

  it('blocks a stale locked gate before provider/runtime work when live reconciliation confirms the block', async () => {
    const h = harness({ isCanvasUnlocked: false, flow: { state: 'DISCONNECTED', url: '', projectId: null } });
    const before = JSON.stringify(h.nodes);
    await h.run();
    // Stale-gate resilience: exactly one bounded reconciliation attempt first.
    expect(h.connection.refreshAccount).toHaveBeenCalledOnce();
    expect(h.connection.refreshFlow).toHaveBeenCalledOnce();
    expect(h.setRunError).toHaveBeenCalledWith(expect.objectContaining({ code: 'NO_FLOW_TAB', retryable: true }));
    expect(h.setRunStatus).toHaveBeenCalledWith('error');
    expect(h.runtime.run).not.toHaveBeenCalled();
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.setConfirmRerun).not.toHaveBeenCalled();
    expect(h.runStartingRef.current).toBe(false);
    expect(JSON.stringify(h.nodes)).toBe(before);
  });

  it('self-heals a stale locked gate when live reconciliation reports a healthy connection', async () => {
    const h = harness({ isCanvasUnlocked: false });
    await h.run();
    expect(h.connection.refreshAccount).toHaveBeenCalledOnce();
    expect(h.connection.refreshFlow).toHaveBeenCalledOnce();
    expect(h.setRunError).not.toHaveBeenCalled();
    expect(h.runtime.run).toHaveBeenCalledOnce();
    expect(h.provider.generate).toHaveBeenCalledOnce();
    expect(h.runStartingRef.current).toBe(false);
  });

  it('allows Restart only after the existing credit confirmation', async () => {
    const h = harness();
    await h.run(false, true, false, 'restart');
    expect(h.setConfirmRerun).toHaveBeenCalledWith(['legacy', 'pending']);
    expect(h.runtime.run).not.toHaveBeenCalled();
    expect(h.provider.generate).not.toHaveBeenCalled();
    await h.run(false, true, true, 'restart');
    expect(h.runtime.run).toHaveBeenCalledOnce();
    expect(h.provider.generate).toHaveBeenCalledOnce();
    expect(source).toContain('CREDIT WARNING');
    expect(source).toContain("runWorkflow(false, true, true, 'restart')");
  });
});

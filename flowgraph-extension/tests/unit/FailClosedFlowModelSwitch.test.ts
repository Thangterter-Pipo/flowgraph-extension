import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  composerChipMatchesRequestedModel,
  flowModelOptionMatchesRequested,
} from '../../src/shared/generationPreflight';
import {
  flowUiModelLabelsEquivalent,
  normalizeFlowUiModelLabel,
} from '../../src/shared/sync/SyncCapabilityRegistry';

const workerSource = () => readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');
const contentSource = () => readFileSync(resolve(__dirname, '../../public/content/flow-content-script.js'), 'utf8');

// Execute the actual worker function without registering extension listeners.
const switchSource = workerSource().split('async function bindRealtimeModel(')[1].split('\nasync function forwardSyncWrite(')[0];
const switchCode = ts.transpileModule(`async function bindRealtimeModel(${switchSource}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
// bindRealtimeModel's local clickAt delegates to the module-level cdpClickAt,
// so the real helper must be extracted alongside it — never stubbed — to keep
// the actual press/hold/release gesture sequence under test.
const cdpClickAtSource = workerSource().split('async function cdpClickAt(')[1].split('// ---------------------------------------------------------------------------')[0];
const cdpClickAtCode = ts.transpileModule(`async function cdpClickAt(${cdpClickAtSource}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function switchHarness(readChip: (reads: number, clicks: number) => string, missingOptionLists = 0) {
  let reads = 0;
  let clicks = 0;
  let optionLists = 0;
  const detach = vi.fn(async () => undefined);
  const sendCommand = vi.fn(async (_target: unknown, method: string, params: Record<string, unknown>) => {
    if (method === 'Runtime.evaluate') {
      const expression = String(params.expression);
      let value: unknown;
      // The production reader now proves model identity from the parent Settings
      // model trigger. That expression also contains `aria-haspopup`, so it must be
      // recognized before the generic submenu-trigger branch below.
      if (expression.includes('const settingsPane = panes.find')) value = readChip(++reads, clicks);
      else if (expression.includes('const modelPane = panes.find')) value = ++optionLists <= missingOptionLists ? [] : [{ text: 'Nano Banana 2', x: 20, y: 20 }];
      else if (expression.includes('const roots =')) value = { ok: false };
      else if (expression.includes('scrollIntoView')) value = { ok: true, x: 10, y: 10 };
      else if (expression.includes("b.click();return true")) value = true;
      else if (expression.includes('hasMode') && expression.includes('hasModel')) value = true;
      else if (expression.includes('length > 0')) value = true;
      else if (expression.includes("document.querySelectorAll('.cdk-overlay-pane") && expression.includes('.length')) value = 0;
      else if (expression.includes('aria-haspopup')) value = { ok: false };
      else throw new Error(`Unexpected evaluation: ${expression}`);
      return { result: { value } };
    }
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased' && params.x === 20) clicks += 1;
    return {};
  });
  const bind = runInNewContext(`${cdpClickAtCode}\n${switchCode}\nbindRealtimeModel`, {
    chrome: { debugger: { attach: vi.fn(async () => undefined), detach, sendCommand } },
    ensureDesktopViewport: async () => undefined,
    ensureInputReachable: async () => undefined,
    waitWhileNotAborted: async (ms: number) => { await new Promise((r) => setTimeout(r, ms)); },
    composerChipMatchesRequestedModel,
    flowModelOptionMatchesRequested,
    bridgeError: (code: string, message: string, retryable: boolean) => Object.assign(new Error(message), { code, retryable }),
    setTimeout,
  }) as (tab: { id: number }, label: string) => Promise<{ ok: true; model: string }>;
  return { bind, detach, sendCommand, reads: () => reads, clicks: () => clicks };
}

afterEach(() => vi.useRealTimers());

function submitHarness(
  bindModel = vi.fn(async () => ({ ok: true as const, model: 'Nano Banana 2' })),
  checkAborted = vi.fn(),
) {
  const source = workerSource().split('const assertModelReadyToSubmit = async () => {')[1]
    .split('const assertMediaReadyToSubmit')[0];
  const code = ts.transpileModule(`const assertModelReadyToSubmit = async () => {${source}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const assertReady = runInNewContext(`${code}\nassertModelReadyToSubmit`, {
    payload: { modelLabel: 'Nano Banana 2' }, requestId: 'test', tab: { id: 1 },
    throwIfGenerationAborted: checkAborted,
    bindRealtimeModel: bindModel,
  }) as () => Promise<void>;
  return { assertReady, bindModel };
}

describe('fail-closed Flow model switch', () => {
  it('returns without input when the chip already proves the requested model', async () => {
    const harness = switchHarness(() => 'Nano Banana 2');
    await expect(harness.bind({ id: 1 }, 'Nano Banana 2')).resolves.toEqual({ ok: true, model: 'Nano Banana 2' });
    expect(harness.sendCommand.mock.calls.some(([, method]) => method.startsWith('Input.'))).toBe(false);
  });

  it('rechecks the live chip at the retry boundary without reopening the menu', async () => {
    vi.useFakeTimers();
    let postClickReads = 0;
    const harness = switchHarness((_reads, clicks) => clicks && ++postClickReads > 8 ? 'Nano Banana 2' : 'Nano Banana Pro');
    await Promise.all([
      expect(harness.bind({ id: 1 }, 'Nano Banana 2')).resolves.toEqual({ ok: true, model: 'Nano Banana 2' }),
      vi.runAllTimersAsync(),
    ]);
    expect(harness.clicks()).toBe(1);
    expect(harness.sendCommand.mock.calls.filter(([, method, params]) =>
      method === 'Runtime.evaluate' && String(params.expression).includes("b.click();return true"))).toHaveLength(1);
  });

  it.each(['Nano Banana Pro', 'Nano Banana 2 Lite', 'Veo 3.1 - Fast', 'Omni Flash', '']) (
    'fails closed after exactly three option attempts for chip %s', async (chip) => {
      vi.useFakeTimers();
      const harness = switchHarness(() => chip);
      await Promise.all([
        expect(harness.bind({ id: 1 }, 'Nano Banana 2')).rejects.toMatchObject({
          code: 'INVALID_MODEL',
          message: `Flow model did not commit "Nano Banana 2" (chip: ${chip || 'none'}).`,
        }),
        vi.runAllTimersAsync(),
      ]);
      expect(harness.clicks()).toBe(3);
      expect(harness.reads()).toBe(33);
      expect(harness.detach).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('fails closed with the last live chip when options never appear', async () => {
    vi.useFakeTimers();
    const harness = switchHarness(() => 'Nano Banana Pro', Infinity);
    await Promise.all([
      expect(harness.bind({ id: 1 }, 'Nano Banana 2')).rejects.toMatchObject({
        code: 'INVALID_MODEL', message: 'Flow model did not commit "Nano Banana 2" (chip: Nano Banana Pro).',
      }),
      vi.runAllTimersAsync(),
    ]);
    expect(harness.clicks()).toBe(0);
    expect(harness.sendCommand.mock.calls.filter(([, method, params]) =>
      method === 'Runtime.evaluate' && String(params.expression).includes('const roots ='))).toHaveLength(3);
  });

  it('fails closed before submit when the production model binder cannot prove the requested model', async () => {
    const failure = Object.assign(new Error('model mismatch'), { code: 'INVALID_MODEL', retryable: true });
    const bindModel = vi.fn(async () => { throw failure; });
    const harness = submitHarness(bindModel);
    await expect(harness.assertReady()).rejects.toMatchObject({ code: 'INVALID_MODEL', retryable: true });
    expect(bindModel).toHaveBeenCalledOnce();
    expect(bindModel).toHaveBeenCalledWith({ id: 1 }, 'Nano Banana 2');
  });

  it('honors cancellation before the final production model proof', async () => {
    const bindModel = vi.fn(async () => ({ ok: true as const, model: 'Nano Banana 2' }));
    const checkAborted = vi.fn(() => { throw new Error('aborted'); });
    const harness = submitHarness(bindModel, checkAborted);
    await expect(harness.assertReady()).rejects.toThrow('aborted');
    expect(bindModel).not.toHaveBeenCalled();
    expect(checkAborted).toHaveBeenCalledOnce();
  });

  it('keeps every Veo, Nano and Omni variant exclusive in both matchers', () => {
    const labels = ['Veo 3.1 - Lite', 'Veo 3.1 - Lite [Lower Priority]', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality',
      'Nano Banana 2', 'Nano Banana 2 Lite', 'Nano Banana Pro', 'Omni 1.1 Flash'];
    for (const requested of labels) {
      for (const live of labels) {
        expect(flowModelOptionMatchesRequested(live, requested), `${live} -> ${requested}`).toBe(live === requested);
        expect(composerChipMatchesRequestedModel(`${live} crop_16_9 x1`, requested), `${live} chip -> ${requested}`).toBe(live === requested);
      }
    }
  });

  it('retries discovery when the menu disappears before the option can be clicked', async () => {
    vi.useFakeTimers();
    const harness = switchHarness((_reads, clicks) => clicks ? 'Nano Banana 2' : 'Nano Banana Pro', 1);
    await Promise.all([
      expect(harness.bind({ id: 1 }, 'Nano Banana 2')).resolves.toEqual({ ok: true, model: 'Nano Banana 2' }),
      vi.runAllTimersAsync(),
    ]);
    expect(harness.clicks()).toBe(1);
    expect(harness.detach).toHaveBeenCalledOnce();
  });
  it('delegates the final pre-submit model proof to the production binder', async () => {
    const bindModel = vi.fn(async () => ({ ok: true as const, model: 'Nano Banana 2' }));
    const checkAborted = vi.fn();
    const harness = submitHarness(bindModel, checkAborted);
    await expect(harness.assertReady()).resolves.toBeUndefined();
    expect(bindModel).toHaveBeenCalledOnce();
    expect(bindModel).toHaveBeenCalledWith({ id: 1 }, 'Nano Banana 2');
    expect(checkAborted).toHaveBeenCalledTimes(2);
  });
  it('waits for a delayed live chip commit without clicking the model again', async () => {
    vi.useFakeTimers();
    let postClickReads = 0;
    const harness = switchHarness((_reads, clicks) => clicks > 0 && ++postClickReads >= 3 ? 'Nano Banana 2' : 'Nano Banana Pro');
    const result = expect(harness.bind({ id: 1 }, 'Nano Banana 2')).resolves.toEqual({ ok: true, model: 'Nano Banana 2' });
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(harness.clicks()).toBe(1);
    expect(harness.detach).toHaveBeenCalledOnce();
  });
  it('reopens and retries when the first option click did not commit', async () => {
    vi.useFakeTimers();
    const harness = switchHarness((_reads, clicks) => clicks >= 2 ? 'Nano Banana 2' : 'Nano Banana Pro');
    await Promise.all([
      expect(harness.bind({ id: 1 }, 'Nano Banana 2')).resolves.toEqual({ ok: true, model: 'Nano Banana 2' }),
      vi.runAllTimersAsync(),
    ]);
    expect(harness.clicks()).toBe(2);
  });

  it('does not treat Nano Banana 2 Lite or Pro as Nano Banana 2', () => {
    expect(flowModelOptionMatchesRequested('🍌 Nano Banana 2 Lite', 'Nano Banana 2')).toBe(false);
    expect(flowModelOptionMatchesRequested('🍌 Nano Banana Pro', 'Nano Banana 2')).toBe(false);
    expect(flowModelOptionMatchesRequested('🍌 Nano Banana 2', 'Nano Banana 2')).toBe(true);
    expect(flowModelOptionMatchesRequested('🍌 Nano Banana 2 arrow_drop_down', '🍌 Nano Banana 2')).toBe(true);
  });

  it('matches the live settings chip against the exact requested variant', () => {
    const chip = '🍌 Nano Banana Pro crop_16_9 x4';
    expect(composerChipMatchesRequestedModel(chip, 'Nano Banana Pro')).toBe(true);
    expect(composerChipMatchesRequestedModel(chip, '🍌 Nano Banana Pro')).toBe(true);
    expect(composerChipMatchesRequestedModel(chip, 'Nano Banana 2')).toBe(false);
    expect(composerChipMatchesRequestedModel(chip, 'Nano Banana 2 Lite')).toBe(false);
  });

  it('keeps Veo Lite/Fast/Quality exclusive', () => {
    expect(flowModelOptionMatchesRequested('Veo 3.1 - Lite', 'Veo 3.1 - Fast')).toBe(false);
    expect(flowModelOptionMatchesRequested('Veo 3.1 - Lite', 'Veo 3.1 - Lite')).toBe(true);
    expect(flowModelOptionMatchesRequested('Omni Flash', 'Omni 1.1 Flash')).toBe(true);
  });

  it('does not infer any model from the nameless Video composer chip', () => {
    const liveChip = 'Video · 720p · 8 giây crop_16_9 x1';
    expect(composerChipMatchesRequestedModel(liveChip, 'Omni 1.1 Flash')).toBe(false);
    expect(composerChipMatchesRequestedModel(liveChip, 'Omni Flash')).toBe(false);
    expect(composerChipMatchesRequestedModel(liveChip, 'Veo 3.1 - Fast')).toBe(false);
    expect(composerChipMatchesRequestedModel(liveChip, 'Veo 3.1 - Lite')).toBe(false);
    expect(composerChipMatchesRequestedModel(liveChip, 'Veo 3.1 - Quality')).toBe(false);
    expect(composerChipMatchesRequestedModel('Veo 3.1 - Fast crop_16_9 x1', 'Omni 1.1 Flash')).toBe(false);
  });

  it('service worker switches model via CDP, not a synthetic content-script click', () => {
    const source = workerSource();
    expect(source).toContain('bindRealtimeModel');
    expect(source).toContain('const settingsPane = panes.find');
    expect(source).toContain('const modelPane = panes.find');
    expect(source).toContain('composerChipMatchesRequestedModel');
    expect(source).toContain('FLOWGRAPH_SYNC_SET_MODEL');
    expect(source).toMatch(/request\.type === 'FLOWGRAPH_SYNC_SET_MODEL'/);
  });

  it('canonicalizes legacy Omni and Veo punctuation without collapsing distinct variants', () => {
    expect(normalizeFlowUiModelLabel('Omni Flash')).toBe('Omni 1.1 Flash');
    expect(normalizeFlowUiModelLabel('Omni 1.1 Flash')).toBe('Omni 1.1 Flash');
    expect(normalizeFlowUiModelLabel('Veo 3.1 Lite')).toBe('Veo 3.1 - Lite');
    expect(normalizeFlowUiModelLabel('Veo Lite')).toBe('Veo 3.1 - Lite');
    expect(normalizeFlowUiModelLabel('Veo Lite [Lower Priority]')).toBe('Veo 3.1 - Lite [Lower Priority]');
    expect(normalizeFlowUiModelLabel('Veo 3.1 – Fast')).toBe('Veo 3.1 - Fast');
    expect(normalizeFlowUiModelLabel('Veo 3.1 — Quality')).toBe('Veo 3.1 - Quality');
    expect(flowUiModelLabelsEquivalent('Omni Flash', 'Omni 1.1 Flash')).toBe(true);
    expect(flowUiModelLabelsEquivalent('Veo 3.1 Lite', 'Veo 3.1 - Lite')).toBe(true);
    expect(flowUiModelLabelsEquivalent('Veo 3.1 - Lite', 'Veo 3.1 - Fast')).toBe(false);
  });

  it('content model readback trusts only the Settings model trigger, never the generic composer chip', () => {
    const source = contentSource();
    const modelRead = source.split('function modelFromChip(_chip) {')[1].split('\n  function ')[0];
    expect(modelRead).toContain('const settingsRoot = roots.find');
    expect(modelRead).toContain('isKnownFlowModel(model) ? model : null');
    expect(modelRead).not.toContain('chip.firstChild');
    expect(modelRead).not.toContain('return rawText');
  });

  it('service-worker readback separates the selected Settings trigger from submenu options', () => {
    const source = workerSource();
    expect(source).toContain('async function bindRealtimeModel(');
    expect(source).toContain('const settingsPane = panes.find');
    expect(source).toContain('const modelPane = panes.find');
    expect(source).toContain('await closeModelMenu();');
  });

  it('content script does not false-succeed on prefix or Veo-family contains', () => {
    const source = contentSource();
    expect(source).not.toContain("cur.includes(req) || req.includes(cur) || (cur.includes('veo') && req.includes('veo'))");
    expect(source).toContain('flowModelOptionMatchesRequested');
  });
});

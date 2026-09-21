import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldFailClosedWhenDebuggerUnavailable } from '../../src/shared/generationPreflight';

const workerSource = () => readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');

describe('fail-closed generate fallback', () => {
  it('fails closed when the debugger is not attached', () => {
    expect(shouldFailClosedWhenDebuggerUnavailable(false)).toBe(true);
    expect(shouldFailClosedWhenDebuggerUnavailable(true)).toBe(false);
  });

  it('does not send FLOWGRAPH_UI_GENERATE or attribute media when CDP attach fails', () => {
    const source = workerSource();
    expect(source).toContain('shouldFailClosedWhenDebuggerUnavailable');
    expect(source).toContain('Chrome debugger is unavailable; generation aborted without a Generate click');
    expect(source).not.toMatch(/type:\s*'FLOWGRAPH_UI_GENERATE'/);
    expect(source).not.toContain('used content-script fallback');
    expect(source).not.toMatch(/chrome\.tabs\.sendMessage\([\s\S]{0,240}FLOWGRAPH_UI_GENERATE/);

    const failClosedIdx = source.indexOf('shouldFailClosedWhenDebuggerUnavailable(attached)');
    expect(failClosedIdx).toBeGreaterThan(-1);
    const failClosedBlock = source.slice(
      failClosedIdx,
      source.indexOf('async function handleMediaStatus', failClosedIdx),
    );
    expect(failClosedBlock).not.toContain('completeGenerate');
    expect(failClosedBlock).not.toContain('emitGenerateProgress');
    expect(failClosedBlock).toMatch(/bridgeError\(\s*'UI_NOT_READY'/);
    expect(failClosedBlock).toMatch(/false,\s*\)/);
  });

  it('keeps the CDP Generate path that re-proves mode/prompt/media before click', () => {
    const source = workerSource();
    expect(source).toContain("await chrome.debugger.attach(target, '1.3')");
    expect(source).toContain('await assertModeReadyToSubmit()');
    expect(source).toContain('await assertPromptReadyToSubmit()');
    expect(source).toContain('await clickAtCenter(fresh.x, fresh.y)');
  });
});

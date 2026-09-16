import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canSubmitGenerateWithComposerMode,
  composerModalityFromChipText,
  requiredComposerModality,
  shouldToleratePreflightFailure,
} from '../../src/shared/generationPreflight';

const workerSource = () => readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');
const studioSource = () => readFileSync(resolve(__dirname, '../../src/ui/studio/main.tsx'), 'utf8');

describe('fail-closed composer mode', () => {
  it('video kinds with image or unknown composer state cannot submit', () => {
    expect(requiredComposerModality('i2v')).toBe('video');
    expect(requiredComposerModality('interpolation')).toBe('video');
    expect(composerModalityFromChipText('nano banana 2')).toBe('image');
    expect(composerModalityFromChipText('')).toBe('unknown');
    expect(canSubmitGenerateWithComposerMode({ kind: 'i2v', liveChipText: 'nano banana 2' })).toBe(false);
    expect(canSubmitGenerateWithComposerMode({ kind: 't2v', liveChipText: '' })).toBe(false);
    expect(canSubmitGenerateWithComposerMode({ kind: 'interpolation' })).toBe(false);
  });

  it('image kinds with video or unknown composer state cannot submit', () => {
    expect(requiredComposerModality('t2i')).toBe('image');
    expect(canSubmitGenerateWithComposerMode({ kind: 't2i', liveChipText: 'video · veo' })).toBe(false);
    expect(canSubmitGenerateWithComposerMode({ kind: 't2i', liveChipText: '' })).toBe(false);
  });

  it('correctly verified mode still reaches the existing submit path', () => {
    expect(canSubmitGenerateWithComposerMode({ kind: 'i2v', liveChipText: 'Video · Veo' })).toBe(true);
    expect(canSubmitGenerateWithComposerMode({ kind: 't2i', liveChipText: 'Nano Banana 2' })).toBe(true);
  });

  it('modeWrite preflight failure is tolerated only because CDP fallback must prove the final mode', () => {
    expect(shouldToleratePreflightFailure({ field: 'mode' })).toBe(true);
    const source = workerSource();
    expect(source).toContain('modeWrite preflight failed; verifying with direct CDP switch');
    expect(source).toContain('await bindRealtimeMode(tab, modeWrite.value);');
    expect(source).toContain('setComposerMode');
  });

  it('service worker fail-closes instead of proceeding on unmatched composer mode', () => {
    const source = workerSource();
    expect(source).toContain('canSubmitGenerateWithComposerMode');
    expect(source).toContain('assertModeReadyToSubmit');
    expect(source).toContain('let finalStableReads = 0;');
    expect(source).toContain('if (finalStableReads >= 2) return { ok: true, value: requested };');
    expect(source).not.toContain('Switch check not matched');
    expect(source).not.toContain('proceeding anyway');
  });

  it('re-checks exact composer mode immediately before Generate click and Enter fallback', () => {
    const source = workerSource();
    expect(source).toMatch(/await assertModeReadyToSubmit\(\);\s*await assertModelReadyToSubmit\(\);\s*await assertMediaReadyToSubmit\(\);\s*await assertPromptReadyToSubmit\(\);\s*await clickAtCenter\(fresh\.x, fresh\.y\);/);
    const enterIdx = source.indexOf("key: 'Enter', code: 'Enter'");
    const clickIdx = source.indexOf('await clickAtCenter(fresh.x, fresh.y);');
    expect(clickIdx).toBeGreaterThan(-1);
    expect(enterIdx).toBeGreaterThan(clickIdx);
    const betweenClickAndEnter = source.slice(clickIdx, enterIdx);
    expect(betweenClickAndEnter).toContain('await assertModeReadyToSubmit()');
  });

  it('uses one semantic click per composer mode selection and fails closed on a mismatched readback', () => {
    const source = readFileSync(resolve(__dirname, '../../public/content/flow-content-script.js'), 'utf8');
    const setMode = source.split('async function setComposerMode(kind) {')[1]?.split('async function generateViaUi')[0] ?? '';
    const writeMode = source.split('async function writeMode(value, originEventId) {')[1]?.split('function normalizeSettingText')[0] ?? '';
    const componentMode = source.split('async function writeReferenceComponentMode(originEventId) {')[1]?.split('async function writeMode')[0] ?? '';
    expect(setMode).toContain('clickMenuItemLike(tab);');
    expect(setMode).not.toContain('tab.click();');
    expect(componentMode).toContain('clickMenuItemLike(tab);');
    expect(componentMode).not.toContain('tab.click();');
    expect(writeMode).toContain('clickMenuItemLike(targetBtn);');
    expect(writeMode).not.toContain('targetBtn.click();');
    expect(writeMode).toMatch(/if \(applied !== value\) \{\s*return \{\s*ok: false/);
  });

  it('reasserts the required composer mode before every model write and blocks dependent writes after a mode failure', () => {
    const source = studioSource();
    expect(source).toContain("if (field === 'model' || activeSync?.nodeId !== syncTarget.id)");
    expect(source).toContain("event.field !== 'mode' && syncFailedFieldsRef.current.has('mode')");
    expect(source).toContain("Cannot apply ${event.field ?? 'setting'} because the required Google Flow mode did not apply.");
  });
});

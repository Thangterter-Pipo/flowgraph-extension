import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canSubmitGenerateWithScalarSettings,
  shouldToleratePreflightFailure,
} from '../../src/shared/generationPreflight';

const workerSource = () => readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');

describe('fail-closed scalar generation settings', () => {
  it('aspect mismatch or write failure cannot submit', () => {
    expect(shouldToleratePreflightFailure({ field: 'aspectRatio' }, { code: 'INVALID_VALUE' })).toBe(false);
    expect(shouldToleratePreflightFailure({ field: 'aspectRatio' }, { code: 'UI_NOT_READY' })).toBe(false);
    expect(canSubmitGenerateWithScalarSettings({
      requested: { aspectRatio: '16:9' },
      verified: { aspectRatio: false },
    })).toBe(false);
  });

  it('batch requested x4 but live/commit differs cannot submit', () => {
    expect(shouldToleratePreflightFailure({ field: 'batchCount', optional: true }, { code: 'INVALID_VALUE' })).toBe(false);
    expect(canSubmitGenerateWithScalarSettings({
      requested: { batchCount: 4 },
      verified: { batchCount: false },
    })).toBe(false);
  });

  it('explicit duration/resolution unverified cannot submit unless proven fixed', () => {
    expect(canSubmitGenerateWithScalarSettings({
      requested: { durationSeconds: 8, targetResolution: '720p' },
      verified: {},
    })).toBe(false);
    expect(canSubmitGenerateWithScalarSettings({
      requested: { durationSeconds: 8, targetResolution: '720p' },
      verified: {},
      fixedByModel: { durationSeconds: true, targetResolution: true },
    })).toBe(true);
    expect(shouldToleratePreflightFailure({ field: 'durationSeconds', optional: true }, { code: 'NO_UI_COUNTERPART' })).toBe(true);
  });

  it('explicit seed cannot be silently dropped', () => {
    expect(shouldToleratePreflightFailure({ field: 'seed' }, { code: 'NO_UI_COUNTERPART' })).toBe(false);
    expect(canSubmitGenerateWithScalarSettings({
      requested: { seed: 42 },
      verified: {},
      fixedByModel: { seed: true },
    })).toBe(false);
    expect(canSubmitGenerateWithScalarSettings({
      requested: { seed: 42 },
      verified: { seed: true },
    })).toBe(true);
  });

  it('valid exact scalar state still reaches submit', () => {
    expect(canSubmitGenerateWithScalarSettings({
      requested: { aspectRatio: '16:9', batchCount: 2, durationSeconds: 8, targetResolution: '720p' },
      verified: { aspectRatio: true, batchCount: true, durationSeconds: true, targetResolution: true },
    })).toBe(true);
  });

  it('content script refuses an unverified explicit seed instead of dropping it', () => {
    const source = readFileSync(resolve(__dirname, '../../public/content/flow-content-script.js'), 'utf8');
    expect(source).toContain('async function writeSeed');
    expect(source).toMatch(/case 'FLOWGRAPH_SYNC_SET_SEED':\s*return writeSeed\(/);
    expect(source).not.toMatch(/case 'FLOWGRAPH_SYNC_SET_SEED':\s*return unsupportedSettingsWrite\('seed'/);
    expect(source).toContain('refusing to spend credits with an unverified explicit seed');
  });

  it('service worker fail-closes scalars and seed before Generate click/Enter', () => {
    const source = workerSource();
    expect(source).toContain('canSubmitGenerateWithScalarSettings');
    expect(source).toContain('assertScalarReadyToSubmit');
    expect(source).toContain("field: 'seed', type: 'FLOWGRAPH_SYNC_SET_SEED'");
    expect(source).not.toMatch(/field: 'durationSeconds'[\s\S]{0,80}optional: true/);
    expect(source).not.toMatch(/field: 'batchCount'[\s\S]{0,80}optional: true/);
    expect(source).not.toMatch(/field: 'targetResolution'[\s\S]{0,120}optional: true/);
  });

  it('re-checks scalars immediately before Generate click and Enter fallback', () => {
    const source = workerSource();
    expect(source).toMatch(/await assertScalarReadyToSubmit\(\);\s*await assertModeReadyToSubmit\(\);/);
    const enterIdx = source.indexOf("key: 'Enter', code: 'Enter'");
    const clickIdx = source.indexOf('await clickAtCenter(fresh.x, fresh.y);');
    expect(clickIdx).toBeGreaterThan(-1);
    expect(enterIdx).toBeGreaterThan(clickIdx);
    expect(source.slice(clickIdx, enterIdx)).toContain('await assertScalarReadyToSubmit()');
  });

  it('gives the content settings-menu retry loop enough time to return a real outcome', () => {
    const source = workerSource();
    const match = source.match(/const SYNC_WRITE_TIMEOUT_MS = ([\d_]+);/);
    expect(match).not.toBeNull();
    const timeoutMs = Number(match![1].replaceAll('_', ''));
    expect(timeoutMs).toBeGreaterThanOrEqual(8_000);
  });

  it('opens composer settings with one click and reacquires remounted triggers', () => {
    const source = readFileSync(resolve(__dirname, '../../public/content/flow-content-script.js'), 'utf8');
    const clickHelper = source
      .split('function clickMenuItemLike(element) {')[1]
      .split('function findSettingsChip()')[0];
    const settingsHelper = source
      .split('async function openComposerSettings() {')[1]
      .split('function findSettingsTab(')[0];

    expect(clickHelper).toContain("fire('click')");
    expect(clickHelper).not.toMatch(/^\s*element\.click\(\);/m);
    expect(settingsHelper).not.toMatch(/^\s*chip\.click\(\);/m);
    expect(settingsHelper).toContain('const chip = findSettingsChip();');
    expect(settingsHelper).toContain('!chip.isConnected');
  });
});

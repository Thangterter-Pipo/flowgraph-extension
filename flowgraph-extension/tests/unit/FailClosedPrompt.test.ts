import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  composerPromptMatchesExpected,
  expectedSubmittedPrompt,
  shouldToleratePreflightFailure,
  truncateFlowPrompt,
} from '../../src/shared/generationPreflight';

describe('fail-closed prompt commit', () => {
  it('rejects stale non-empty composer text that is not the expected prompt', () => {
    const expected = expectedSubmittedPrompt('A paper boat on a lake');
    expect(composerPromptMatchesExpected('A leftover prompt from the last run', expected)).toBe(false);
    expect(composerPromptMatchesExpected('A paper boat', expected)).toBe(false);
    expect(composerPromptMatchesExpected('', expected)).toBe(false);
  });

  it('allows submit only when live composer text equals the exact normalized prompt', () => {
    const expected = expectedSubmittedPrompt('A paper boat on a lake');
    expect(composerPromptMatchesExpected('A paper boat on a lake', expected)).toBe(true);
    expect(composerPromptMatchesExpected('  A   paper boat on a lake\n', expected)).toBe(true);
  });

  it('verifies >1150 prompts against the truncated safePrompt, not the original', () => {
    const original = `${'word '.repeat(400)}END`;
    expect(original.length).toBeGreaterThan(1150);
    const safe = truncateFlowPrompt(original);
    expect(safe.length).toBeLessThanOrEqual(1151);
    expect(safe).not.toBe(original);
    const expected = expectedSubmittedPrompt(original);
    expect(composerPromptMatchesExpected(original, expected)).toBe(false);
    expect(composerPromptMatchesExpected(safe, expected)).toBe(true);
  });

  it('does not regress model fail-closed preflight', () => {
    expect(shouldToleratePreflightFailure({ field: 'model' }, { code: 'NO_UI_COUNTERPART' })).toBe(false);
  });

  it('service worker fail-closes instead of proceeding on unconfirmed prompt', () => {
    const source = readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');
    expect(source).toContain('composerPromptMatchesExpected');
    expect(source).toContain('expectedSubmittedPrompt');
    expect(source).not.toContain('Prompt strict match unconfirmed, proceeding anyway');
    expect(source).not.toMatch(/return text\.length > 0;/);
  });

  it('re-checks exact match immediately before Generate click and Enter fallback', () => {
    const source = readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');
    expect(source).toMatch(/await assertPromptReadyToSubmit\(\);\s*await clickAtCenter\(fresh\.x, fresh\.y\);/);
    const enterIdx = source.indexOf("key: 'Enter', code: 'Enter'");
    const clickIdx = source.indexOf('await clickAtCenter(fresh.x, fresh.y);');
    expect(clickIdx).toBeGreaterThan(-1);
    expect(enterIdx).toBeGreaterThan(clickIdx);
    const betweenClickAndEnter = source.slice(clickIdx, enterIdx);
    expect(betweenClickAndEnter).toContain('await assertPromptReadyToSubmit()');
  });
});

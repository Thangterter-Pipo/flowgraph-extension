import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { normalizeError } from '../../src/shared/bridge';

describe('normalizeError', () => {
  it('preserves a bridge code carried by an Error instance', () => {
    const error = Object.assign(new Error('Wrong Google Flow project.'), {
      code: 'PROJECT_MISMATCH',
      retryable: true,
    });

    expect(normalizeError(error)).toEqual({
      code: 'PROJECT_MISMATCH',
      message: 'Wrong Google Flow project.',
      retryable: true,
    });
  });

  it('keeps the shipped Google Flow content bridge syntactically valid', () => {
    const source = readFileSync(resolve(__dirname, '../../public/content/flow-content-script.js'), 'utf8');
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain("chrome.runtime.onMessage.addListener");
  });

  it('requires a post-injection ping before treating the Flow content bridge as ready', () => {
    const source = readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');
    const helper = source.split('async function ensureFlowContentScript(tabId: number): Promise<void> {')[1]
      ?.split('// The Google Flow project UUID')[0] ?? '';
    expect(helper).toContain("files: ['content/flow-content-script.js']");
    expect(helper).toContain('if (await bridgeReady()) return;');
    expect(helper).toContain('Flow content bridge did not become ready after injection');
  });
});

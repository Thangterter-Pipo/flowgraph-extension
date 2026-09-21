import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../src/ui/sidepanel/main.tsx'), 'utf8');
// Exercise the actual local functions without mounting the extension entry point.
function loadFunction(name: string, globals: Record<string, unknown> = {}) {
  const ast = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const code = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(`${code}; ${name}`, { React, ...icons, ...globals });
}

function browser(tabs: object[]) {
  return {
    tabs: { query: vi.fn().mockResolvedValue(tabs), update: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}) },
    windows: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe('Companion tab navigation', () => {
  it.each(['https://labs.google/fx/tools/flow/project/abc', 'https://flow.google.com/project/abc'])(
    'activates an existing Flow tab: %s', async (url) => {
      const chrome = browser([{ id: 7, windowId: 0, url }]);
      await loadFunction('openTab', { chrome })('https://flow.google.com');
      expect(chrome.tabs.query).toHaveBeenCalledWith({});
      expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
      expect(chrome.windows.update).toHaveBeenCalledWith(0, { focused: true });
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    },
  );
  it('creates a tab only when no usable Flow tab exists', async () => {
    const chrome = browser([{ id: 2, url: 'https://example.com' }]);
    await loadFunction('openTab', { chrome })('https://flow.google.com');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://flow.google.com' });
  });
  it('supports browser preview without Chrome APIs', async () => {
    const open = vi.fn();
    await loadFunction('openTab', { window: { open } })('https://flow.google.com');
    expect(open).toHaveBeenCalledWith('https://flow.google.com', '_blank', 'noopener,noreferrer');
  });
});

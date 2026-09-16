import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applySelectAllNodes, isEditableKeyTarget, isSelectAllShortcut } from '../../src/ui/studio/canvasKeyboard';

describe('canvas select-all', () => {
  it('does not intercept typing in inputs or contenteditable', () => {
    expect(isEditableKeyTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableKeyTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableKeyTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableKeyTarget({ tagName: 'DIV' })).toBe(false);
  });

  it('marks every node selected without changing ids or topology', () => {
    const nodes = [
      { id: 'a', selected: false, position: { x: 1, y: 2 } },
      { id: 'b', selected: true, position: { x: 3, y: 4 } },
    ];
    expect(applySelectAllNodes(nodes)).toEqual([
      { id: 'a', selected: true, position: { x: 1, y: 2 } },
      { id: 'b', selected: true, position: { x: 3, y: 4 } },
    ]);
  });

  it('detects Ctrl/Cmd+A via key or code', () => {
    expect(isSelectAllShortcut({ key: 'a', ctrlKey: true })).toBe(true);
    expect(isSelectAllShortcut({ key: 'A', metaKey: true })).toBe(true);
    expect(isSelectAllShortcut({ code: 'KeyA', ctrlKey: true })).toBe(true);
    expect(isSelectAllShortcut({ key: 'a' })).toBe(false);
  });

  it('Studio intercepts Ctrl/Cmd+A on capture outside editors', () => {
    const mainSrc = readFileSync(resolve(__dirname, '../../src/ui/studio/main.tsx'), 'utf8');
    expect(mainSrc).toContain('applySelectAllNodes');
    expect(mainSrc).toContain('isSelectAllShortcut');
    expect(mainSrc).toMatch(/addEventListener\('keydown', handleKeyDown, true\)/);
  });
});

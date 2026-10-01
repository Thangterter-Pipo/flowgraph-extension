import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '../../src/ui/sidepanel/Sidepanel';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  } };
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Sidepanel copy feedback', () => {
  it.each(['false', 'throw', 'reject', 'success', 'clipboard'])('handles %s without false success and cleans fallback DOM', async mode => {
    hooks.values = []; hooks.cursor = 0;
    vi.useFakeTimers();
    const removeChild = vi.fn();
    const writeText = vi.fn().mockImplementation(async () => { if (mode === 'reject') throw new Error('Denied'); });
    vi.stubGlobal('navigator', { clipboard: ['reject', 'clipboard'].includes(mode) ? { writeText } : undefined });
    vi.stubGlobal('document', {
      createElement: () => ({ value: '', style: {}, focus() {}, select() {} }),
      body: { appendChild: vi.fn(), removeChild },
      execCommand: () => { if (mode === 'throw') throw new Error('Denied'); return mode === 'success'; },
    });
    const view = CopyButton({ text: 'project-id' });
    const button = React.isValidElement(view) && view.type === 'button' ? view : view.props.children[0];
    await button.props.onClick();
    hooks.cursor = 0;
    const html = renderToStaticMarkup(CopyButton({ text: 'project-id' }));
    if (['success', 'clipboard'].includes(mode)) expect(html).toContain('Đã sao chép');
    else {
      expect(html).not.toContain('Đã sao chép');
      expect(html).toContain('role="alert"');
      expect(html).toContain('Không thể sao chép');
    }
    if (!['reject', 'clipboard'].includes(mode)) expect(removeChild).toHaveBeenCalledTimes(1);
  });
});

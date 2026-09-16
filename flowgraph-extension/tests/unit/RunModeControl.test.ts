import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RunModeControl } from '../../src/ui/studio/RunModeControl';

function buttons(element: React.ReactNode): React.ReactElement[] {
  if (!React.isValidElement(element)) return [];
  return [ ...(element.type === 'button' ? [element] : []),
    ...React.Children.toArray(element.props.children).flatMap(buttons) ];
}
const props = () => ({ running: false, disabled: false, menuOpen: false,
  onMenuChange: vi.fn(), onContinue: vi.fn(), onRestart: vi.fn(), onStop: vi.fn() });

describe('run split button', () => {
  it('keeps continue primary and puts only restart in the dropdown', () => {
    const p = props();
    const tree = RunModeControl({ ...p, menuOpen: true });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Tiếp tục chạy');
    expect((html.match(/role="menuitem"/g) ?? [])).toHaveLength(1);
    const items = buttons(tree);
    items[0].props.onClick();
    expect(p.onContinue).toHaveBeenCalledOnce();
    expect(p.onRestart).not.toHaveBeenCalled();
    items.find((item) => item.props.role === 'menuitem')!.props.onClick();
    expect(p.onMenuChange).toHaveBeenCalledWith(false);
    expect(p.onRestart).toHaveBeenCalledOnce();
  });
  it('locks both split segments while running, closes menu, and retains Stop', () => {
    const p = props();
    const tree = RunModeControl({ ...p, running: true, menuOpen: true });
    const items = buttons(tree);
    expect(items[0].props.disabled).toBe(true);
    expect(items[1].props.disabled).toBe(true);
    expect(renderToStaticMarkup(tree)).not.toContain('role="menuitem"');
    const stop = items[2];
    expect(stop.props.disabled).not.toBe(true);
    stop.props.onClick();
    expect(p.onStop).toHaveBeenCalledOnce();
  });
  it('locks both segments when the connection gate is closed', () => {
    const items = buttons(RunModeControl({ ...props(), disabled: true }));
    expect(items.every((item) => item.props.disabled)).toBe(true);
  });
});

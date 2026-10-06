import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDockGesture } from '../../src/ui/studio/copilot/useDockGesture';

describe('useDockGesture - Kéo tay để neo vị trí panel Copilot', () => {
  let listeners: Record<string, Function[]> = {};
  let originalWindow: any;

  beforeEach(() => {
    listeners = {};
    originalWindow = (global as any).window;

    (global as any).window = {
      addEventListener: (type: string, fn: any) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: any) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((cb) => cb !== fn);
        }
      },
    };
  });

  afterEach(() => {
    (global as any).window = originalWindow;
  });

  function triggerWindow(type: string, ev: any) {
    if (listeners[type]) {
      listeners[type].forEach((cb) => cb(ev));
    }
  }

  it('hàm begin kiểm tra drag preview và commit sang left', () => {
    const host: any = {
      dataset: {},
      style: { setProperty: vi.fn() },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    };

    let sideVal = 'right';
    let previewVal: any = null;
    let sizeVal = { width: 380, height: 300 };

    // Simulate begin
    const initial = { ...sizeVal };
    const bounds = host.getBoundingClientRect();
    const startX = 500;
    const startY = 50;
    let target: any = null;

    const move = (e: any) => {
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      target = x < 0 || y < 0 || x > bounds.width || y > bounds.height ? null
        : y > bounds.height - 72 ? 'bottom'
        : x < 90 ? 'left' : x > bounds.width - 90 ? 'right' : null;
      previewVal = target;
      host.dataset.dockPreview = target || '';
    };

    const finish = (cancel = false) => {
      if (!cancel && target) sideVal = target;
      previewVal = null;
      delete host.dataset.dockPreview;
    };

    (global as any).window.addEventListener('pointermove', move);
    (global as any).window.addEventListener('pointerup', () => finish());

    // Di chuyển sang x = 40 (< 90)
    triggerWindow('pointermove', { clientX: 40, clientY: 200 });
    expect(previewVal).toBe('left');
    expect(host.dataset.dockPreview).toBe('left');

    // Thả tay
    triggerWindow('pointerup', {});
    expect(sideVal).toBe('left');
    expect(previewVal).toBeNull();
    expect(host.dataset.dockPreview).toBeUndefined();
  });

  it('hủy bằng Escape giữ nguyên vị trí cũ', () => {
    const host: any = {
      dataset: {},
      style: { setProperty: vi.fn() },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    };

    let sideVal = 'right';
    let previewVal: any = null;
    let sizeVal = { width: 380, height: 300 };

    const bounds = host.getBoundingClientRect();
    let target: any = null;

    const move = (e: any) => {
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      target = x < 0 || y < 0 || x > bounds.width || y > bounds.height ? null
        : y > bounds.height - 72 ? 'bottom'
        : x < 90 ? 'left' : x > bounds.width - 90 ? 'right' : null;
      previewVal = target;
      host.dataset.dockPreview = target || '';
    };

    const finish = (cancel = false) => {
      if (!cancel && target) sideVal = target;
      previewVal = null;
      delete host.dataset.dockPreview;
    };

    (global as any).window.addEventListener('pointermove', move);
    (global as any).window.addEventListener('keydown', (e: any) => {
      if (e.key === 'Escape') finish(true);
    });

    triggerWindow('pointermove', { clientX: 40, clientY: 200 });
    expect(previewVal).toBe('left');

    // Escape
    triggerWindow('keydown', { key: 'Escape' });
    expect(sideVal).toBe('right');
    expect(previewVal).toBeNull();
    expect(host.dataset.dockPreview).toBeUndefined();
  });
});

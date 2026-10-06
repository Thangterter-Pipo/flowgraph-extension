import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export type DockSide = 'left' | 'right' | 'bottom';

export function useDockGesture() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<DockSide>('bottom');
  const [preview, setPreview] = useState<DockSide | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [size, setSize] = useState({ width: 640, height: 220 });
  const normalizedInitialSizeRef = useRef(false);

  // Keep an already-mounted panel from retaining the old oversized defaults
  // after the compact layout pass. Once the user resizes it, their choice wins.
  useEffect(() => {
    if (normalizedInitialSizeRef.current) return;
    normalizedInitialSizeRef.current = true;
    setSize((current) => ({
      width: side === 'bottom' ? Math.min(current.width || 640, 640) : Math.min(current.width, 320),
      height: Math.min(current.height, 220),
    }));
  }, [side]);

  useEffect(() => {
    const host = panelRef.current?.parentElement;
    if (!host) return;
    host.dataset.copilotDock = side;
    host.style.setProperty('--copilot-width', `${size.width}px`);
    host.style.setProperty('--copilot-height', `${size.height}px`);
  }, [side, size]);
  useEffect(() => () => cleanupRef.current?.(), []);

  function begin(event: ReactPointerEvent, resize = false) {
    if (event.button !== 0 || (!resize && (event.target as HTMLElement).closest('button'))) return;
    const host = panelRef.current?.parentElement;
    if (!host) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();
    const bounds = host.getBoundingClientRect();
    const initial = { ...size };
    const startX = event.clientX;
    const startY = event.clientY;
    let target: DockSide | null = null;
    const move = (e: PointerEvent) => {
      if (resize) {
        setSize({
          width: Math.max(280, Math.min(420, bounds.width * 0.5, initial.width + (side === 'left' ? e.clientX - startX : startX - e.clientX))),
          height: Math.max(180, Math.min(bounds.height * 0.55, initial.height + startY - e.clientY)),
        });
        return;
      }
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      target = x < 0 || y < 0 || x > bounds.width || y > bounds.height ? null
        : y > bounds.height - 72 ? 'bottom'
        : x < 90 ? 'left' : x > bounds.width - 90 ? 'right' : null;
      setPreview(target);
      host.dataset.dockPreview = target || '';
    };
    const finish = (cancel = false) => {
      if (!cancel && !resize && target) {
        setSide(target);
        if (target === 'bottom' && side !== 'bottom') {
          setSize({ width: 640, height: 220 });
        } else if (target !== 'bottom' && side === 'bottom') {
          setSize({ width: 320, height: 220 });
        }
      }
      if (cancel && resize) setSize(initial);
      setPreview(null);
      delete host.dataset.dockPreview;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', abort);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', abort);
      cleanupRef.current = null;
    };
    const up = () => finish();
    const abort = () => finish(true);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(true); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', abort);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', abort);
    cleanupRef.current = abort;
  }
  return { panelRef, side, preview, begin };
}

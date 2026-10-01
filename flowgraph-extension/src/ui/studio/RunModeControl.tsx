import React from 'react';
import { ChevronDown, Play, RotateCcw, Square } from 'lucide-react';

interface Props {
  running: boolean;
  disabled: boolean;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  onContinue: () => void;
  onRestart: () => void;
  onStop: () => void;
}

export function RunModeControl(props: Props) {
  const locked = props.running || props.disabled;
  return <>
    <div role="group" aria-label="Chạy workflow" style={{ display: 'inline-flex', position: 'relative' }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) props.onMenuChange(false); }}
      onKeyDown={(event) => { if (event.key === 'Escape') props.onMenuChange(false); }}>
      <button className="fg-btn fg-btn-primary" style={{ borderRadius: '8px 0 0 8px' }} disabled={locked}
        onClick={props.onContinue}><Play size={14} /> Tiếp tục chạy</button>
      <button className="fg-btn fg-btn-primary" style={{ borderRadius: '0 8px 8px 0', borderLeft: '1px solid rgba(255,255,255,.3)', padding: '0 8px' }}
        disabled={locked} aria-label="Tùy chọn chạy" aria-haspopup="menu" aria-expanded={props.menuOpen && !locked}
        onClick={() => props.onMenuChange(!props.menuOpen)}><ChevronDown size={14} /></button>
      {props.menuOpen && !locked && <div role="menu" aria-label="Tùy chọn chạy" className="run-mode-menu"
        style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 100, borderRadius: 8, padding: 4, whiteSpace: 'nowrap' }}>
        <button role="menuitem" className="fg-btn run-restart-btn" onClick={() => { props.onMenuChange(false); props.onRestart(); }}>
          <RotateCcw size={14} /> Chạy lại từ đầu
        </button>
      </div>}
    </div>
    {props.running && <button className="fg-btn fg-btn-danger" onClick={props.onStop} aria-label="Dừng workflow"><Square size={13} /> Dừng workflow</button>}
  </>;
}

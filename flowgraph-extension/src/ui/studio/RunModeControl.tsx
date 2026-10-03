import React from 'react';
import { ChevronDown, Play, RotateCcw, Square, Zap, Sparkles } from 'lucide-react';

interface Props {
  running: boolean;
  disabled: boolean;
  menuOpen: boolean;
  onMenuChange: (open: boolean) => void;
  onContinue: () => void;
  onRestart: () => void;
  onRunViaFlowUi?: () => void;
  onStop: () => void;
  qualityMode?: 'DRAFT' | 'MASTER';
  onToggleQualityMode?: (mode: 'DRAFT' | 'MASTER') => void;
}

export function RunModeControl(props: Props) {
  const locked = props.running || props.disabled;
  const isDraft = props.qualityMode === 'DRAFT';

  return <>
    <div role="group" aria-label="Chạy workflow" style={{ display: 'inline-flex', position: 'relative' }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) props.onMenuChange(false); }}
      onKeyDown={(event) => { if (event.key === 'Escape') props.onMenuChange(false); }}>
      <button className="fg-btn fg-btn-primary" style={{ borderRadius: '8px 0 0 8px' }} disabled={locked}
        onClick={props.onContinue}>
        {isDraft ? <Zap size={14} fill="#eab308" color="#eab308" /> : <Play size={14} />}
        {isDraft ? ' Chạy nhanh (Draft)' : ' Tiếp tục chạy'}
      </button>
      <button className="fg-btn fg-btn-primary" style={{ borderRadius: '0 8px 8px 0', borderLeft: '1px solid rgba(255,255,255,.3)', padding: '0 8px' }}
        disabled={locked} aria-label="Tùy chọn chạy" aria-haspopup="menu" aria-expanded={props.menuOpen && !locked}
        onClick={() => props.onMenuChange(!props.menuOpen)}><ChevronDown size={14} /></button>
      {props.menuOpen && !locked && <div role="menu" aria-label="Tùy chọn chạy" className="run-mode-menu"
        style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 100, borderRadius: 8, padding: 4, whiteSpace: 'nowrap' }}>
        <button role="menuitem" className="fg-btn run-restart-btn" onClick={() => { props.onMenuChange(false); props.onRestart(); }}>
          <RotateCcw size={14} /> Chạy lại từ đầu
        </button>
        {props.onRunViaFlowUi && (
          <button role="menuitem" className="fg-btn run-flow-ui-btn" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { props.onMenuChange(false); props.onRunViaFlowUi?.(); }}>
            <Play size={14} /> Chạy qua giao diện Flow (Flow UI)
          </button>
        )}
        {props.onToggleQualityMode && (
          <button role="menuitem" className="fg-btn run-quality-toggle-btn" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => { props.onMenuChange(false); props.onToggleQualityMode?.(isDraft ? 'MASTER' : 'DRAFT'); }}>
            {isDraft ? <Sparkles size={14} color="#3b82f6" /> : <Zap size={14} color="#eab308" />}
            {isDraft ? 'Chuyển sang Master HQ (Chuẩn)' : 'Chuyển sang Draft (Nhanh 4s/720p)'}
          </button>
        )}
      </div>}
    </div>
    {props.running && <button className="fg-btn fg-btn-danger" onClick={props.onStop} aria-label="Dừng workflow"><Square size={13} /> Dừng workflow</button>}
  </>;
}

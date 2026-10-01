import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CloudDownload, Copy, ExternalLink, FolderOpen, Image, LoaderCircle, Plus, RefreshCcw, Sparkles, Video, Workflow, X } from 'lucide-react';
import { RealGoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import { createSidepanelController } from './controller';
import { bindSidepanel } from './lifecycle';
import { openFlow, openStudio, studioIsOpen } from './navigation';

import { creditsView, HISTORY_KEY, LEGACY_HISTORY_KEY, readLastRun, runStatusText, type LastRun } from './state';

export function formatTruncatedUuid(id: string): string {
  if (!id || id.length <= 12) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

export function CopyButton({ text, label = 'Sao chép' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function handleCopy() {
    setCopied(false); setCopyError(false);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        try {
          ta.focus();
          ta.select();
          if (!document.execCommand('copy')) throw new Error('Copy rejected');
        } finally { document.body.removeChild(ta); }
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <><button
      type="button"
      className="sp-copy-btn"
      aria-label={`${label}: ${text}`}
      title={copied ? 'Đã sao chép!' : `${label}: ${text}`}
      onClick={handleCopy}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      <span className="sp-copy-text">{copied ? 'Đã sao chép' : 'Sao chép'}</span>
    </button>{copyError && <span role="alert" className="sp-error">Không thể sao chép. Vui lòng thử lại.</span>}</>
  );
}

type Controller = ReturnType<typeof createSidepanelController>;
type Snapshot = ReturnType<Controller['getSnapshot']>;

export function CreateProjectDialog({ busy, locked, error, createdProject, onClose, onCreate }: {
  busy: boolean; locked: boolean; error?: string; onClose: () => void; onCreate: (title: string) => Promise<void>;
  createdProject?: Snapshot['pendingCreated'];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="sp-dialog" aria-modal="true" aria-labelledby="sp-create-heading" aria-describedby="sp-create-help"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form aria-busy={busy} onSubmit={event => { event.preventDefault(); if (!busy && !locked) void onCreate(title); }}>
      <div className="sp-dialog-heading"><span className="sp-dialog-icon"><FolderOpen size={22} aria-hidden="true" /></span>
        <button type="button" className="sp-icon-button" aria-label="Đóng hộp thoại" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
      <h2 id="sp-create-heading">{createdProject ? 'Đã tạo dự án' : 'Tạo dự án mới'}</h2><p className="sp-dialog-subtitle">{createdProject ? createdProject.projectTitle : 'Một không gian mới cho ý tưởng tiếp theo.'}</p>
      {createdProject ? <p id="sp-create-help">Dự án đã được giữ lại. Thử chọn lại, không tạo thêm dự án.</p> : <><div className="sp-label-row"><label htmlFor="sp-new-title">Tên dự án</label><span id="sp-title-count">{title.length}/100</span></div>
      <input id="sp-new-title" autoFocus maxLength={100} value={title} placeholder="Ví dụ: Bộ phim đầu tiên của tôi" disabled={busy}
        aria-describedby="sp-title-count sp-create-help" onChange={event => setTitle(event.target.value)} />
      <p id="sp-create-help">Để trống để dùng tên “Dự án chưa đặt tên”.</p></>}
      {error && <p role="alert" className="sp-error">{error}</p>}
      <div className="sp-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>Hủy</button>
        <button type="submit" className="sp-primary" disabled={busy || locked}>{busy ? <><LoaderCircle size={16} className="sp-spin" aria-hidden="true" />{createdProject ? 'Đang chọn…' : 'Đang tạo…'}</> : createdProject ? 'Thử chọn lại' : 'Tạo'}</button></div>
    </form>
  </dialog>;
}

export function SidepanelView({ state, controller, lastRun, historyError }: {
  state: Snapshot; controller: Controller; lastRun: LastRun | null; historyError?: string;
}) {
  const [actionError, setActionError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(state.flow.projectId ?? '');
  const credits = creditsView(state.credits, state.refreshing);
  const latestError = state.logs.find((log) => log.error);
  const projectLocked = state.running || state.selecting;
  const checking = !state.selecting && (state.account.state === 'CHECKING' || state.flow.state === 'CHECKING');
  // PROJECT_REQUIRED is a connected Flow landing page: allow the first project to be created.
  const connected = state.account.state === 'CONNECTED'
    && (['READY', 'CONNECTED', 'PROJECT_REQUIRED'].includes(state.flow.state) || state.selecting);
  async function action(work: () => Promise<unknown>) {
    setActionError(undefined); setOpening(true);
    try { await work(); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setOpening(false); }
  }
  return <main className="sp-app" data-screen={checking ? 'connecting' : connected ? 'projects' : 'welcome'}>
    <header className="sp-header">
      <h1><span className="sp-logo"><Workflow size={21} aria-hidden="true" /></span>FlowGraph</h1>
      <div className="sp-header-actions">
        <button type="button" className="sp-icon-button" aria-label="Làm mới kết nối" title="Làm mới kết nối và dự án"
          disabled={state.refreshing || state.projectsLoading}
          onClick={() => void Promise.all([controller.refresh(), controller.loadProjects()])}>
          <RefreshCcw size={17} className={state.refreshing ? 'sp-spin' : ''} aria-hidden="true" /></button>
        {connected && <button type="button" className="sp-primary sp-new" disabled={projectLocked} onClick={() => setShowCreate(true)}>
          <Plus size={16} aria-hidden="true" />Tạo mới</button>}
      </div>
      {connected && <div className="sp-account" title={state.account.email}><span className="sp-dot" />
        <span>{state.account.email || 'Tài khoản đã kết nối'}</span><span className="sp-account-label">Đã kết nối</span></div>}
    </header>
    <div className="sp-content">
      {(state.account.error || state.flow.error) && <p className="sp-error" role="alert">{state.account.error || state.flow.error}</p>}
      {actionError && <p className="sp-error" role="alert">{actionError}</p>}
      {latestError && <p role="alert" className="sp-error">{latestError.text}</p>}
      {checking ? <section className="sp-hero" role="status" aria-live="polite">
        <div className="sp-radar" aria-hidden="true"><span /><Workflow size={32} /></div>
        <span className="sp-eyebrow">KẾT NỐI KHÔNG GIAN SÁNG TẠO</span>
        <h2>Đang kết nối Google Flow...</h2><p>Đang phát hiện tab Google Flow và phiên làm việc...</p>
        <div className="sp-connection-line"><LoaderCircle size={14} className="sp-spin" aria-hidden="true" />Đang đồng bộ phiên làm việc</div>
      </section> : !connected ? <section className="sp-hero sp-welcome">
        <div className="sp-browser-art" aria-hidden="true"><div className="sp-browser-bar"><i /><i /><i /><span>Google Flow</span></div>
          <div className="sp-art-canvas"><span className="sp-art-node"><Image size={22} /></span><span className="sp-art-wire" />
            <span className="sp-art-node sp-art-main"><Workflow size={30} /></span><span className="sp-art-wire" /><span className="sp-art-node"><Video size={22} /></span></div>
          <div className="sp-art-caption"><Sparkles size={13} />Ý tưởng của bạn. Kết nối thành quả.</div></div>
        <span className="sp-eyebrow">Ý TƯỞNG CỦA BẠN, KHÔNG GIỚI HẠN</span>
        <h2>Workflow AI trực quan cho Google Flow</h2>
        <p>Kết nối Google Flow để biến ý tưởng thành ảnh và video với quy trình trực quan.</p>
        <div className="sp-pills"><span><Image size={13} aria-hidden="true" />Tạo ảnh AI</span><span><Video size={13} aria-hidden="true" />Tạo video</span><span><Workflow size={13} aria-hidden="true" />Workflow trực quan</span></div>
        <button type="button" className="sp-primary sp-wide" disabled={opening} onClick={() => void action(openFlow)}>Mở Google Flow<ArrowUpRight size={18} aria-hidden="true" /></button>
        <p className="sp-hint">Mở Flow và đăng nhập tài khoản Google để bắt đầu.</p>
      </section> : <>
        <div className="sp-section-heading"><div><span className="sp-eyebrow">KHÔNG GIAN LÀM VIỆC</span><h2>Dự án của bạn</h2></div>
          <span className="sp-count" aria-label={`${state.projects.length} dự án`}>{state.projects.length}</span></div>
        <div className="sp-status" role="status" aria-live="polite">{state.running ? 'Đang chạy — không thể đổi dự án.' : state.selecting ? 'Đang chọn và xác nhận dự án…'
          : state.projectsLoading ? 'Đang tải danh sách dự án…' : !state.projectsLoaded && !state.projectsError ? 'Chưa tải danh sách dự án. Bấm làm mới để tải.' : ''}</div>
        {state.projectsError && !state.projects.length && <div className="sp-error" role="alert"><p>{state.projectsError}</p>
          <button type="button" disabled={state.projectsLoading} onClick={() => void controller.loadProjects()}>Thử tải lại dự án</button></div>}
        {!state.projects.length && state.projectsLoaded && !state.projectsLoading && !state.projectsError ? <section className="sp-hero sp-empty">
          <div className="sp-empty-icon"><FolderOpen size={38} strokeWidth={1.3} aria-hidden="true" /><span><Plus size={13} /></span></div>
          <h2>Chưa có dự án nào</h2><p>Tạo dự án đầu tiên để bắt đầu tạo ảnh và video bằng FlowGraph Studio.</p>
          <button type="button" className="sp-primary" disabled={projectLocked} onClick={() => setShowCreate(true)}><Plus size={17} aria-hidden="true" />Tạo dự án</button>
        </section> : <ul className="sp-project-list" aria-label="Danh sách dự án" aria-busy={state.projectsLoading}>
          {state.projects.map((project) => {
            const selected = project.projectId === state.flow.projectId;
            const title = project.projectTitle || 'Dự án chưa đặt tên';
            const date = project.creationTime ? new Date(project.creationTime) : undefined;
            const hue = Array.from(project.projectId).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 0);
            return <li className={`sp-project-card${selected ? ' is-selected' : ''}`} key={project.projectId}>
              <button type="button" className="sp-project-select" disabled={projectLocked} aria-label={`Chọn dự án ${title}`} aria-pressed={selected}
                onClick={() => { setSelectedProjectId(project.projectId); void controller.selectProject(project.projectId); }}>
                <span className="sp-thumbnail" style={{ '--project-hue': hue } as React.CSSProperties} aria-hidden="true"><Workflow size={26} /><span>{title.slice(0, 2).toUpperCase()}</span></span>
                <span className="sp-project-info"><strong title={title}>{title}</strong>{selected && <span className="sp-selected"><Check size={11} aria-hidden="true" />Đang chọn</span>}
                  {date && Number.isFinite(date.getTime()) && <span className="sp-meta">Tạo {date.toLocaleDateString('vi-VN')}</span>}</span>
              </button>
              <div className="sp-card-footer"><code title={project.projectId}>ID · {formatTruncatedUuid(project.projectId)}</code><CopyButton text={project.projectId} label="Sao chép ID" /></div>
            </li>;
          })}
        </ul>}

      </>}
    </div>
    {connected && !checking ? <footer className="sp-bottom-actions">
      <button type="button" className="sp-studio sp-wide" disabled={opening || !selectedProjectId} title={!selectedProjectId ? 'Chọn hoặc tạo Project trước khi mở Studio' : undefined} onClick={() => void action(openStudio)}><Workflow size={19} aria-hidden="true" />Mở Studio<ArrowUpRight size={17} aria-hidden="true" /></button>
      <div className="sp-utilities"><button type="button" disabled={opening} onClick={() => void action(openFlow)}><ExternalLink size={15} aria-hidden="true" />Trang Flow</button>
        <button type="button" disabled={opening} onClick={() => void action(async () => {
          if (typeof chrome === 'undefined' || !chrome.downloads?.showDefaultFolder) throw new Error('Không mở được thư mục tải xuống.');
          await chrome.downloads.showDefaultFolder();
        })}><CloudDownload size={16} aria-hidden="true" />Tệp đã tải</button></div>
    </footer> : <footer className="sp-brand-footer">FLOWGRAPH STUDIO <span>Không gian sáng tạo của bạn</span></footer>}
    {showCreate && <CreateProjectDialog busy={creating} locked={projectLocked} error={state.projectsError} createdProject={state.pendingCreated}
      onClose={() => setShowCreate(false)} onCreate={async title => {
        if (creating || projectLocked) return;
        setCreating(true);
        try { await controller.createProject(title); if (!controller.getSnapshot().projectsError) { setSelectedProjectId(controller.getSnapshot().flow.projectId ?? ''); setShowCreate(false); } }
        finally { setCreating(false); }
      }} />}
  </main>;
}

export function Sidepanel() {
  const [controller, setController] = useState<Controller>();
  const [state, setState] = useState<Snapshot>();
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [historyError, setHistoryError] = useState<string>();
  useEffect(() => {
    const current = createSidepanelController(new RealGoogleFlowAdapter(), studioIsOpen);
    let active = true;
    function history() {
      if (!active) return;
      try {
        setLastRun(readLastRun(localStorage.getItem(HISTORY_KEY) ?? localStorage.getItem(LEGACY_HISTORY_KEY), current.getSnapshot().flow.projectId));
        setHistoryError(undefined);
      } catch (error) {
        setLastRun(null); setHistoryError(`Không đọc được lịch sử: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let projectId: string | undefined;
    const unsubscribe = current.subscribe(() => {
      setState(current.getSnapshot());
      if (projectId !== current.getSnapshot().flow.projectId) {
        projectId = current.getSnapshot().flow.projectId; history();
      }
    });
    setController(current); setState(current.getSnapshot());
    const cleanup = bindSidepanel(current, history);
    return () => {
      active = false; unsubscribe(); cleanup();
    };
  }, []);
  return controller && state ? <SidepanelView state={state} controller={controller} lastRun={lastRun} historyError={historyError} />
    : <main className="sp-app" role="status">Đang mở bảng điều khiển…</main>;
}

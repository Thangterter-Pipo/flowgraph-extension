// ProjectGate (FG-0205) — full canvas lock overlay + project dropdown/create UI.
// When the canvas is locked the user sees PROJECT REQUIRED and can select or
// create a real Google Flow project before the runtime will accept a Run.
import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, FolderKanban, Plus, RefreshCcw, X } from 'lucide-react';
import type { ProjectInfo } from '../../shared/bridge';
import type { ActiveProjectState, StudioConnection, RunBlockReason } from './useStudioConnection';

export function ConnectionPill({ state, label, onRefresh, icon, title, className }: {
  state: 'checking' | 'online' | 'warn' | 'offline' | 'error';
  label: string;
  onRefresh?: () => void;
  icon: React.ReactNode;
  title?: string;
  className?: string;
}) {
  const content = <>
    <span className={`fg-status-dot ${state}`} />
    {icon}
    <span className="connection-label">{label}</span>
    {onRefresh && <RefreshCcw size={11} className="connection-refresh" />}
  </>;

  if (onRefresh) {
    return (
      <button
        type="button"
        className={`connection-pill ${state} ${className ?? ''}`}
        onClick={onRefresh}
        title={title ?? 'Click to refresh'}
      >
        {content}
      </button>
    );
  }

  return <div className={`connection-pill ${state} ${className ?? ''}`} title={title} role="status">{content}</div>;
}

function accountPillLabel(state: string, email?: string, credits?: number): string {
  if (state === 'CHECKING') return 'Đang kiểm tra tài khoản…';
  if (state === 'CONNECTED') {
    const credText = credits !== undefined ? ` · ⚡ ${credits} cr` : '';
    return (email ?? 'Google Account') + credText;
  }
  if (state === 'SESSION_EXPIRED') return 'Phiên đã hết hạn';
  if (state === 'DISCONNECTED') return 'Tài khoản đã ngắt kết nối';
  if (state === 'ERROR') return 'Lỗi tài khoản';
  return 'Google Account';
}

function flowPillLabel(state: string, projectId?: string): string {
  if (state === 'CHECKING') return 'Đang kiểm tra Flow…';
  if (state === 'READY') return `Flow · ${projectId?.slice(0, 8) ?? 'sẵn sàng'}`;
  if (state === 'PROJECT_REQUIRED') return 'Flow · Cần Project';
  if (state === 'CONNECTED') return 'Flow đã kết nối';
  if (state === 'DISCONNECTED') return 'Flow đã ngắt kết nối';
  if (state === 'ERROR') return 'Lỗi Flow';
  return 'Google Flow';
}

export function ProjectDropdown({ connection, runLocked = false }: { connection: StudioConnection; runLocked?: boolean }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    if (runLocked) setOpen(false);
  }, [runLocked]);

  useEffect(() => {
    if (open && connection.projects.length === 0 && !connection.projectsLoading) {
      void connection.refreshProjects();
    }
  }, [open, connection.projects.length, connection.projectsLoading, connection]);

  async function createAndSelect() {
    if (runLocked) return;
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      await connection.createProject(title);
      setNewTitle('');
      setOpen(false);
    } finally {
      setCreating(false);
    }
  }

  const activeId = connection.activeProject?.projectId;

  return (
    <div className="project-dropdown">
      <button
        className="fg-btn project-dropdown-trigger"
        disabled={runLocked}
        title={runLocked ? 'Dừng workflow trước khi đổi Project' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { if (runLocked) return; setOpen((value) => !value); }}
      >
        <FolderKanban size={13} />
        <span className="project-dropdown-active">{activeId ? connection.activeProject?.projectName ?? 'Flow Project' : 'Chọn Project'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="project-dropdown-menu" role="menu">
          <div className="project-menu-head">
            <strong>GOOGLE FLOW PROJECTS</strong>
            <button className="fg-icon-btn" onClick={() => void connection.refreshProjects()} title="Làm mới danh sách Project" aria-label="Làm mới danh sách Project"><RefreshCcw size={12} /></button>
            <button className="fg-icon-btn" onClick={() => setOpen(false)} aria-label="Đóng danh sách project"><X size={12} /></button>
          </div>
          <div className="project-menu-list">
            {connection.projectsLoading && <div className="project-menu-note" role="status" aria-live="polite">Đang tải danh sách Project…</div>}
            {!connection.projectsLoading && connection.projectsError && <div className="project-menu-note error">{connection.projectsError}</div>}
            {!connection.projectsLoading && !connection.projectsError && connection.projects.length === 0 && <div className="project-menu-note">Chưa có Project — tạo một Project bên dưới.</div>}
            {connection.projects.map((project: ProjectInfo) => (
              <button
                className={`project-menu-item ${project.projectId === activeId ? 'active' : ''}`}
                key={project.projectId}
                onClick={() => { if (runLocked) return; void connection.selectProject(project.projectId); setOpen(false); }}
                disabled={runLocked}
              >
                <span className="project-menu-item-name">{project.projectTitle}</span>
                <span className="project-menu-item-id">{project.projectId.slice(0, 8)}…</span>
                {project.projectId === activeId && <Check size={12} className="project-menu-item-check" />}
              </button>
            ))}
          </div>
          <div className="project-create-row">
            <input
              className="form-control"
              placeholder="New project title…"
              value={newTitle}
              disabled={runLocked}
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void createAndSelect(); }}
            />
            <button className="fg-btn fg-btn-primary" onClick={() => void createAndSelect()} disabled={runLocked || creating || !newTitle.trim()}>
              <Plus size={12} /> {creating ? 'Đang tạo…' : 'Tạo Project'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectGateOverlay({ connection, children }: {
  connection: StudioConnection;
  children: React.ReactNode;
}) {
  if (connection.isCanvasUnlocked) return <>{children}</>;
  // Studio chỉ được mở từ lịch sử hoặc sau khi tạo Project trong Sidepanel.
  // Nếu người dùng mở trực tiếp studio.html, không dựng canvas/gate card giả;
  // giữ một màn hình khóa tối giản cho tới khi có Project được chọn thật.
  if (!connection.activeProject?.projectId) {
    return <div className="canvas-project-required" role="status" aria-live="polite">
      <strong>Chưa có Project</strong>
      <span>Hãy chọn hoặc tạo Project trong Sidepanel để mở Studio.</span>
    </div>;
  }
  const block = connection.runBlockReason;

  const getExplanation = () => {
    if (connection.account.state === 'CHECKING' || connection.flow.state === 'CHECKING') {
      return 'Đang xác minh tài khoản, tab Flow và Project hiện tại…';
    }
    if (connection.account.state !== 'CONNECTED') {
      if (connection.account.state === 'SESSION_EXPIRED') {
        return 'Phiên Google Flow đã hết hạn. Hãy làm mới tab Flow và đăng nhập lại.';
      }
      if (connection.account.state === 'ERROR') {
        return connection.account.error || 'Không xác minh được tài khoản Google. Hãy làm mới tab Flow.';
      }
      return 'Hãy kết nối tài khoản Google và mở Google Flow để mở khóa workspace.';
    }
    if (connection.flow.state === 'ERROR') {
      return connection.flow.error || 'Tab Google Flow đang báo lỗi. Hãy kiểm tra tab Flow và làm mới.';
    }
    if (connection.flow.state === 'DISCONNECTED' || !connection.flow.url) {
      return 'Chưa tìm thấy tab Google Flow. Hãy mở https://flow.google.com/ trong tab khác.';
    }
    if (connection.flow.state === 'PROJECT_REQUIRED' || !connection.flow.projectId) {
      return 'Google Flow đã mở nhưng chưa ở trong Project. Hãy mở một Project trong Flow.';
    }
    if (block?.code === 'PROJECT_MISMATCH') {
      return block.message;
    }
    if (!connection.activeProject?.projectId) {
      return 'Chọn hoặc tạo Project Google Flow để mở khóa workspace.';
    }
    return block?.message || 'Chọn hoặc tạo Project Google Flow để mở khóa workspace.';
  };

  const getTitle = () => {
    if (connection.account.state === 'CHECKING' || connection.flow.state === 'CHECKING') {
      return 'ĐANG KIỂM TRA KẾT NỐI…';
    }
    if (connection.account.state !== 'CONNECTED') {
      return 'CẦN KẾT NỐI TÀI KHOẢN';
    }
    if (connection.flow.state === 'DISCONNECTED' || !connection.flow.url) {
      return 'CẦN MỞ TAB FLOW';
    }
    if (connection.flow.state === 'ERROR' || (connection.account as any).state === 'ERROR') {
      return 'LỖI KẾT NỐI';
    }
    if (block?.code === 'PROJECT_MISMATCH') {
      return 'PROJECT KHÔNG KHỚP';
    }
    return 'CẦN CHỌN PROJECT';
  };

  return (
    <div className="canvas-gate">
      {children}
      <div className="canvas-gate-overlay" role="dialog" aria-modal="true" aria-labelledby="canvas-gate-title" aria-describedby="canvas-gate-description" aria-busy={connection.account.state === 'CHECKING' || connection.flow.state === 'CHECKING'}>
        <div className="canvas-gate-card">
          <FolderKanban size={30} />
          <h2 id="canvas-gate-title">{getTitle()}</h2>
          <p id="canvas-gate-description" role="status" aria-live="polite">{getExplanation()}</p>
          <div className="canvas-gate-actions">
            <ProjectDropdown connection={connection} />
            <button className="fg-btn" onClick={() => { void connection.refreshFlow(); void connection.refreshAccount(); }}>
              Làm mới trạng thái
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { accountPillLabel, flowPillLabel };
export type { ActiveProjectState };

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
  if (state === 'CHECKING') return 'Checking Account…';
  if (state === 'CONNECTED') {
    const credText = credits !== undefined ? ` · ⚡ ${credits} cr` : '';
    return (email ?? 'Google Account') + credText;
  }
  if (state === 'SESSION_EXPIRED') return 'Session Expired';
  if (state === 'DISCONNECTED') return 'Account Disconnected';
  if (state === 'ERROR') return 'Account Error';
  return 'Google Account';
}

function flowPillLabel(state: string, projectId?: string): string {
  if (state === 'CHECKING') return 'Checking Flow…';
  if (state === 'READY') return `Flow · ${projectId?.slice(0, 8) ?? 'ready'}`;
  if (state === 'PROJECT_REQUIRED') return 'Flow · Project required';
  if (state === 'CONNECTED') return 'Flow Connected';
  if (state === 'DISCONNECTED') return 'Flow Disconnected';
  if (state === 'ERROR') return 'Flow Error';
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
        title={runLocked ? 'Stop the run before switching project' : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { if (runLocked) return; setOpen((value) => !value); }}
      >
        <FolderKanban size={13} />
        <span className="project-dropdown-active">{activeId ? connection.activeProject?.projectName ?? 'Flow Project' : 'Select Project'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="project-dropdown-menu" role="menu">
          <div className="project-menu-head">
            <strong>GOOGLE FLOW PROJECTS</strong>
            <button className="fg-icon-btn" onClick={() => void connection.refreshProjects()} title="Refresh projects"><RefreshCcw size={12} /></button>
            <button className="fg-icon-btn" onClick={() => setOpen(false)} aria-label="Đóng danh sách project"><X size={12} /></button>
          </div>
          <div className="project-menu-list">
            {connection.projectsLoading && <div className="project-menu-note">Loading projects…</div>}
            {!connection.projectsLoading && connection.projectsError && <div className="project-menu-note error">{connection.projectsError}</div>}
            {!connection.projectsLoading && !connection.projectsError && connection.projects.length === 0 && <div className="project-menu-note">No projects found — create one below.</div>}
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
              <Plus size={12} /> {creating ? 'Creating…' : 'Create'}
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
  const block = connection.runBlockReason;

  const getExplanation = () => {
    if (connection.account.state === 'CHECKING' || connection.flow.state === 'CHECKING') {
      return 'Checking connection status with Google Flow. Please wait a moment…';
    }
    if (connection.account.state !== 'CONNECTED') {
      if (connection.account.state === 'SESSION_EXPIRED') {
        return 'Your Google Flow session has expired. Please refresh the Google Flow tab and sign in again.';
      }
      if (connection.account.state === 'ERROR') {
        return connection.account.error || 'Google Account authentication error. Refresh the Google Flow tab.';
      }
      return 'Connect your Google Account and open the FlowGraph tab in Google Flow to unlock the workspace.';
    }
    if (connection.flow.state === 'ERROR') {
      return connection.flow.error || 'Google Flow tab is in an error state. Check the console in Google Flow and refresh.';
    }
    if (connection.flow.state === 'DISCONNECTED' || !connection.flow.url) {
      return 'No active Google Flow tab detected. Open https://flow.google.com/ in another tab to connect.';
    }
    if (connection.flow.state === 'PROJECT_REQUIRED' || !connection.flow.projectId) {
      return 'Google Flow is open, but not inside a project. Please navigate into a project on Google Flow.';
    }
    if (block?.code === 'PROJECT_MISMATCH') {
      return block.message;
    }
    if (!connection.activeProject?.projectId) {
      return 'Select or create a Google Flow project to unlock the workspace.';
    }
    return block?.message || 'Select or create a Google Flow project to unlock the workspace.';
  };

  const getTitle = () => {
    if (connection.account.state === 'CHECKING' || connection.flow.state === 'CHECKING') {
      return 'CHECKING CONNECTION…';
    }
    if (connection.account.state !== 'CONNECTED') {
      return 'ACCOUNT REQUIRED';
    }
    if (connection.flow.state === 'DISCONNECTED' || !connection.flow.url) {
      return 'FLOW TAB REQUIRED';
    }
    if (connection.flow.state === 'ERROR' || (connection.account as any).state === 'ERROR') {
      return 'CONNECTION ERROR';
    }
    if (block?.code === 'PROJECT_MISMATCH') {
      return 'PROJECT MISMATCH';
    }
    return 'PROJECT REQUIRED';
  };

  return (
    <div className="canvas-gate">
      {children}
      <div className="canvas-gate-overlay">
        <div className="canvas-gate-card">
          <FolderKanban size={30} />
          <h2>{getTitle()}</h2>
          <p>{getExplanation()}</p>
          <div className="canvas-gate-actions">
            <ProjectDropdown connection={connection} />
            <button className="fg-btn" onClick={() => { void connection.refreshFlow(); void connection.refreshAccount(); }}>
              Refresh Status
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { accountPillLabel, flowPillLabel };
export type { ActiveProjectState };

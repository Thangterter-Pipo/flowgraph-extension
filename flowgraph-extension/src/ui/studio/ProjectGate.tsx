// ProjectGate (FG-0205) — full canvas lock overlay + project dropdown/create UI.
// When the canvas is locked the user sees PROJECT REQUIRED and can select or
// create a real Google Flow project before the runtime will accept a Run.
import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, FolderKanban, Plus, RefreshCcw, X } from 'lucide-react';
import type { ProjectInfo } from '../../shared/bridge';
import type { ActiveProjectState, StudioConnection } from './useStudioConnection';

export function ConnectionPill({ state, label, onRefresh, icon, title }: {
  state: 'checking' | 'online' | 'warn' | 'offline' | 'error';
  label: string;
  onRefresh?: () => void;
  icon: React.ReactNode;
  title?: string;
}) {
  return (
    <div className={`connection-pill ${state}`} onClick={onRefresh} title={title ?? (onRefresh ? 'Click to refresh' : undefined)} role={onRefresh ? 'button' : 'status'} tabIndex={onRefresh ? 0 : undefined}>
      <span className={`fg-status-dot ${state}`} />
      {icon}
      <span className="connection-label">{label}</span>
      {onRefresh && <RefreshCcw size={11} className="connection-refresh" />}
    </div>
  );
}

function accountPillLabel(state: string, email?: string, credits?: number): string {
  if (state === 'CHECKING') return 'Checking Account…';
  if (state === 'CONNECTED') {
    const credText = credits !== undefined ? ` · ⚡ ${credits} cr` : ' · ⚡ PRO (Daily)';
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

export function ProjectDropdown({ connection }: { connection: StudioConnection }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    if (open && connection.projects.length === 0 && !connection.projectsLoading) {
      void connection.refreshProjects();
    }
  }, [open, connection.projects.length, connection.projectsLoading, connection]);

  async function createAndSelect() {
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
      <button className="fg-btn project-dropdown-trigger" onClick={() => setOpen((value) => !value)}>
        <FolderKanban size={13} />
        <span className="project-dropdown-active">{activeId ? connection.activeProject?.projectName ?? 'Flow Project' : 'Select Project'}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="project-dropdown-menu">
          <div className="project-menu-head">
            <strong>GOOGLE FLOW PROJECTS</strong>
            <button className="fg-icon-btn" onClick={() => void connection.refreshProjects()} title="Refresh projects"><RefreshCcw size={12} /></button>
            <button className="fg-icon-btn" onClick={() => setOpen(false)}><X size={12} /></button>
          </div>
          <div className="project-menu-list">
            {connection.projectsLoading && <div className="project-menu-note">Loading projects…</div>}
            {!connection.projectsLoading && connection.projectsError && <div className="project-menu-note error">{connection.projectsError}</div>}
            {!connection.projectsLoading && !connection.projectsError && connection.projects.length === 0 && <div className="project-menu-note">No projects found — create one below.</div>}
            {connection.projects.map((project: ProjectInfo) => (
              <button
                className={`project-menu-item ${project.projectId === activeId ? 'active' : ''}`}
                key={project.projectId}
                onClick={() => { void connection.selectProject(project.projectId); setOpen(false); }}
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
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void createAndSelect(); }}
            />
            <button className="fg-btn fg-btn-primary" onClick={() => void createAndSelect()} disabled={creating || !newTitle.trim()}>
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
  return (
    <div className="canvas-gate">
      {children}
      <div className="canvas-gate-overlay">
        <div className="canvas-gate-card">
          <FolderKanban size={30} />
          <h2>PROJECT REQUIRED</h2>
          <p>
            {connection.account.state !== 'CONNECTED'
              ? 'Connect your Google Account and open the FlowGraph tab in Google Flow to unlock the canvas.'
              : 'Select or create a Google Flow project to unlock the workspace.'}
          </p>
          <div className="canvas-gate-actions">
            <ProjectDropdown connection={connection} />
            {connection.activeProject && <button className="fg-btn" onClick={() => void connection.refreshFlow()}>Refresh Flow</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

export { accountPillLabel, flowPillLabel };
export type { ActiveProjectState };

import React, { useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, DatabaseBackup, FolderSearch2, HardDrive, History, RefreshCw, TriangleAlert, Video } from 'lucide-react';
import type { FilmProject, FilmTake } from '../../types/film';
import { allShots, updateShot } from './filmModel';
import { deleteProjectVersion, listProjectVersions, snapshotProject, type ProjectVersion } from './projectVersions';
import { diffProjects } from './productionChecks';

type Props = {
  project: FilmProject;
  setProject: React.Dispatch<React.SetStateAction<FilmProject>>;
};

type ValidationIssue = {
  kind: string;
  shotId?: string;
  shotNumber?: string;
  takeId?: string;
  fileName?: string;
  localPath?: string;
  message: string;
};

type Health = {
  ok: boolean;
  issues: ValidationIssue[];
  takeCount: number;
  mediaReady: number;
  proxyReady: number;
  missingMedia: number;
};

const SERVICE = 'http://127.0.0.1:3091';

function fmtDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function patchTake(project: FilmProject, takeId: string, patch: Partial<FilmTake>): FilmProject {
  const shot = allShots(project).find((item) => item.takes.some((take) => take.id === takeId));
  if (!shot) return project;
  return updateShot(project, shot.id, (currentShot) => ({
    ...currentShot,
    takes: currentShot.takes.map((take) => take.id === takeId ? { ...take, ...patch } : take),
  }));
}

export default function ProductionWorkspace({ project, setProject }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>(() => listProjectVersions(project.id));
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [relinkRoot, setRelinkRoot] = useState('');

  const takes = useMemo(() => allShots(project).flatMap((shot) => shot.takes), [project]);
  const localTakes = takes.filter((take) => take.localPath);
  const proxyTakes = takes.filter((take) => take.proxyPath);

  const call = async <T,>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(`${SERVICE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || `Service error ${response.status}`);
    return data as T;
  };

  const validate = async () => {
    setBusy('validate');
    setMessage('');
    try {
      const result = await call<Health>('/validate', { project });
      setHealth(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Production service unavailable');
    } finally {
      setBusy('');
    }
  };

  useEffect(() => { void validate(); }, [project.updatedAt]);

  const makeVersion = () => {
    setVersions(snapshotProject(project, 'MANUAL'));
    setMessage('Manual project version created.');
  };

  const restoreVersion = (version: ProjectVersion) => {
    const restored = { ...version.project, updatedAt: new Date().toISOString() };
    setProject(restored);
    setMessage(`Restored ${version.label}.`);
  };

  const generateProxies = async () => {
    const candidates = takes.filter((take) => take.localPath && !take.proxyPath);
    if (!candidates.length) {
      setMessage('All available media already has a proxy.');
      return;
    }
    setBusy('proxy');
    setMessage('');
    let next = project;
    let created = 0;
    try {
      for (const take of candidates) {
        const result = await call<{ ok: boolean; proxyPath: string; proxyUrl?: string }>('/proxy', { path: take.localPath, takeId: take.id });
        next = patchTake(next, take.id, { proxyPath: result.proxyPath, proxyUrl: result.proxyUrl });
        created += 1;
      }
      next = { ...next, updatedAt: new Date().toISOString() };
      setProject(next);
      setMessage(`Created ${created} proxy file${created === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Proxy generation failed');
    } finally {
      setBusy('');
    }
  };

  const relink = async () => {
    if (!relinkRoot.trim()) {
      setMessage('Enter a folder path to search for missing media.');
      return;
    }
    setBusy('relink');
    setMessage('');
    try {
      const result = await call<{ ok: boolean; matches: Record<string, string>; count: number }>('/relink', { project, searchRoot: relinkRoot.trim() });
      let next = project;
      Object.entries(result.matches).forEach(([takeId, localPath]) => {
        next = patchTake(next, takeId, { localPath });
      });
      setProject({ ...next, updatedAt: new Date().toISOString() });
      setMessage(result.count ? `Relinked ${result.count} missing media file${result.count === 1 ? '' : 's'}.` : 'No matching files found.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Relink failed');
    } finally {
      setBusy('');
    }
  };

  const packageProject = async () => {
    setBusy('package');
    setMessage('');
    try {
      const result = await call<{ ok: boolean; packagePath: string; mediaCopied: number; missing: string[] }>('/package', { project });
      setMessage(`Package created: ${result.packagePath} · ${result.mediaCopied} media files${result.missing.length ? ` · ${result.missing.length} missing` : ''}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Project packaging failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="production-workspace">
      <header className="production-header">
        <div>
          <div className="film-kicker">PROJECT / MEDIA MANAGEMENT</div>
          <h2>Production Health</h2>
          <p>Validate source media, create editing proxies, relink missing files, restore project versions and package the film for transfer or archive.</p>
        </div>
        <button className="fg-btn" onClick={() => void validate()} disabled={Boolean(busy)}><RefreshCw size={14} /> Validate</button>
      </header>

      <section className="production-stats">
        <div><Video size={16} /><span>Takes</span><strong>{takes.length}</strong></div>
        <div><HardDrive size={16} /><span>Media online</span><strong>{health?.mediaReady ?? localTakes.length}</strong></div>
        <div><DatabaseBackup size={16} /><span>Proxies</span><strong>{health?.proxyReady ?? proxyTakes.length}</strong></div>
        <div className={health?.missingMedia ? 'warning' : 'ok'}>{health?.missingMedia ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}<span>Missing media</span><strong>{health?.missingMedia ?? 0}</strong></div>
      </section>

      <section className="production-grid">
        <div className="production-card">
          <div className="production-card-head"><HardDrive size={14} /><strong>Media Integrity</strong><span>{health?.ok ? 'READY' : health ? 'ATTENTION' : 'UNKNOWN'}</span></div>
          <div className="production-actions-row">
            <button className="fg-btn fg-btn-primary" onClick={() => void generateProxies()} disabled={Boolean(busy)}><DatabaseBackup size={13} /> Generate Proxies</button>
          </div>
          <div className="production-relink">
            <input value={relinkRoot} onChange={(event) => setRelinkRoot(event.target.value)} placeholder="Folder to search, e.g. C:\Users\...\Downloads" />
            <button className="fg-btn" onClick={() => void relink()} disabled={Boolean(busy)}><FolderSearch2 size={13} /> Relink</button>
          </div>
          <div className="production-issues">
            {health?.issues.length ? health.issues.map((issue, index) => (
              <div className="production-issue" key={`${issue.kind}-${issue.takeId ?? index}`}>
                <TriangleAlert size={13} />
                <div><strong>{issue.kind.replaceAll('_', ' ')}</strong><span>{issue.shotNumber ? `Shot ${issue.shotNumber} · ` : ''}{issue.fileName ?? issue.takeId ?? 'Timeline'}</span><small>{issue.message}</small></div>
              </div>
            )) : <div className="production-empty"><CheckCircle2 size={18} /><strong>No media integrity issues</strong><span>Project sources and timeline references are healthy.</span></div>}
          </div>
        </div>

        <div className="production-card">
          <div className="production-card-head"><History size={14} /><strong>Version History</strong><span>{versions.length}/20</span></div>
          <button className="fg-btn fg-btn-primary production-version-create" onClick={makeVersion}><History size={13} /> Create Version</button>
          <div className="production-version-list">
            {versions.map((version) => {
              const diff = diffProjects(version.project, project);
              const changes = [
                diff.shotsAdded ? `+${diff.shotsAdded} shot` : '',
                diff.shotsRemoved ? `-${diff.shotsRemoved} shot` : '',
                diff.shotsChanged ? `${diff.shotsChanged} edited` : '',
                diff.scenesAdded ? `+${diff.scenesAdded} scene` : '',
                diff.scenesRemoved ? `-${diff.scenesRemoved} scene` : '',
                diff.takesAdded ? `+${diff.takesAdded} take` : '',
                diff.timelineClipsChanged ? 'timeline changed' : '',
                diff.assetsChanged ? 'assets changed' : '',
              ].filter(Boolean);
              return (
                <div className="production-version production-version-v4" key={version.id}>
                  <div><strong>{version.label}</strong><span>{version.kind} · {fmtDate(version.createdAt)}</span><small>{changes.length ? changes.join(' · ') : 'No changes from current project'}</small></div>
                  <button onClick={() => restoreVersion(version)}>Restore</button>
                  <button className="danger" onClick={() => setVersions(deleteProjectVersion(project.id, version.id))}>×</button>
                </div>
              );
            })}
            {!versions.length && <div className="production-empty compact"><span>No saved versions yet.</span></div>}
          </div>
        </div>

        <div className="production-card package-card">
          <div className="production-card-head"><Archive size={14} /><strong>Project Package</strong><span>ZIP</span></div>
          <p>Creates an archive with project JSON, all available source takes and generated proxy files. Missing media is reported instead of silently omitted.</p>
          <button className="fg-btn fg-btn-primary" onClick={() => void packageProject()} disabled={Boolean(busy)}><Archive size={13} /> Package Project</button>
        </div>
      </section>

      <footer className="production-footer">
        <span>{busy ? `Working: ${busy}…` : message || 'Autosave is active. Automatic versions are retained separately from the current project state.'}</span>
      </footer>
    </main>
  );
}

import type { FilmProject } from '../../types/film';

export type ProjectVersionKind = 'AUTO' | 'MANUAL';

export interface ProjectVersion {
  id: string;
  createdAt: string;
  kind: ProjectVersionKind;
  label: string;
  project: FilmProject;
}

const keyFor = (projectId: string) => `flowgraph.film.versions.${projectId}`;

export function listProjectVersions(projectId: string): ProjectVersion[] {
  try {
    const raw = localStorage.getItem(keyFor(projectId));
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function snapshotProject(project: FilmProject, kind: ProjectVersionKind = 'MANUAL', label?: string): ProjectVersion[] {
  const current = listProjectVersions(project.id);
  if (kind === 'AUTO') {
    const lastAuto = current.find((item) => item.kind === 'AUTO');
    if (lastAuto && Date.now() - new Date(lastAuto.createdAt).getTime() < 60_000) return current;
  }
  const version: ProjectVersion = {
    id: `version-${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind,
    label: label || (kind === 'AUTO' ? 'Autosave' : `Version ${current.filter((item) => item.kind === 'MANUAL').length + 1}`),
    project: JSON.parse(JSON.stringify(project)) as FilmProject,
  };
  const next = [version, ...current].slice(0, 20);
  localStorage.setItem(keyFor(project.id), JSON.stringify(next));
  return next;
}

export function deleteProjectVersion(projectId: string, versionId: string): ProjectVersion[] {
  const next = listProjectVersions(projectId).filter((item) => item.id !== versionId);
  localStorage.setItem(keyFor(projectId), JSON.stringify(next));
  return next;
}

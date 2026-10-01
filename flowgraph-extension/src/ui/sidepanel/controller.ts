import type { GoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import type { AccountStatus, CreditsData, FlowStatus, ProjectInfo } from '../../shared/bridge';
import { formatFlowgraphRuntimeEvent, type FlowgraphRuntimeEventMessage } from './runtimeEventLog';

interface Snapshot {
  account: AccountStatus; flow: FlowStatus; credits?: CreditsData;
  refreshing: boolean; projects: ProjectInfo[]; projectsLoading: boolean; projectsLoaded: boolean;
  projectsError?: string; selecting: boolean; running: boolean;
  pendingCreated?: ProjectInfo;
  studioOpen: boolean | undefined;
  logs: Array<{ id: number; time: string; text: string; error: boolean }>;
  liveRun?: FlowgraphRuntimeEventMessage;
}
const ACTIVE_PROJECT_KEY = 'flowgraph.activeProject';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function publishActiveProject(project: ProjectInfo): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify({
      projectId: project.projectId,
      projectName: project.projectTitle,
      selectedAt: new Date().toISOString(),
    }));
  } catch {
    // Studio vẫn có thể đồng bộ qua Flow health check nếu storage bị khóa.
  }
}

export function extractProjectId(input: string): string {
  const trimmed = input.trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuid.test(trimmed)) return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const match = url.hostname === 'flow.google.com'
      ? url.pathname.match(/^\/project\/([^/]+)\/?$/)
      : url.hostname === 'labs.google'
        ? url.pathname.match(/^\/fx\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?tools\/flow\/project\/([^/]+)\/?$/)
        : null;
    return match && uuid.test(match[1]) ? match[1].toLowerCase() : '';
  } catch { return ''; }
}

export function createSidepanelController(
  adapter: Pick<GoogleFlowAdapter, 'healthCheck' | 'listProjects' | 'selectProject'> & Partial<Pick<GoogleFlowAdapter, 'createProject'>>,
  studioIsOpen: () => Promise<boolean | undefined>,
) {
  let state: Snapshot = { account: { state: 'CHECKING' }, flow: { state: 'CHECKING' },
    refreshing: false, projects: [], projectsLoading: false, projectsLoaded: false, selecting: false,
    running: false, studioOpen: undefined, logs: [] };
  let disposed = false, revision = 0, queued = false, logId = 0, runtimeRevision = 0;
  let healthWork: Promise<void> | undefined;
  let projectsWork: Promise<void> | undefined;
  let projectsQueued = false;
  let selectionWork: Promise<void> | undefined;
  const runs = new Set<string>();
  const listeners = new Set<() => void>();
  function publish(patch: Partial<Snapshot>) {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (healthWork) return healthWork;
    healthWork = (async () => {
      do {
        queued = false;
        const version = revision;
        const runVersion = runtimeRevision;
        publish({ refreshing: true });
        try {
          const [healthResult, studioResult] = await Promise.allSettled([adapter.healthCheck(), studioIsOpen()]);
          if (disposed || version !== revision) continue;
          const studioOpen = studioResult.status === 'fulfilled' ? studioResult.value : undefined;
          // Execution lives in Studio; only a confirmed absence can retire orphan runs.
          if (studioOpen === false && runVersion === runtimeRevision) {
            runs.clear();
            publish({ running: false, liveRun: ['running', 'validating', 'queued'].includes(state.liveRun?.status ?? '')
              ? undefined : state.liveRun });
          }
          publish({ studioOpen });
          if (healthResult.status === 'rejected') throw healthResult.reason;
          const health = healthResult.value;
          publish({ ...health, credits: health.credits });
        } catch (error) {
          if (version === revision) publish({ account: { state: 'ERROR', error: errorText(error) },
            flow: { state: 'ERROR', error: errorText(error) }, credits: { error: errorText(error) } });
        }
      } while (queued && !disposed);
    })().finally(() => { healthWork = undefined; publish({ refreshing: false }); });
    return healthWork;
  }
  function flowChanged(flow: FlowStatus) {
    revision++;
    publish({ flow, credits: undefined, projects: [], projectsLoaded: false, projectsError: undefined, pendingCreated: undefined });
    if (healthWork) queued = true;
    else void refresh();
  }
  function loadProjects(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (projectsWork) {
      projectsQueued = true;
      return projectsWork;
    }
    const version = revision;
    publish({ projectsLoading: true, projectsError: undefined });
    projectsWork = (async () => {
      try {
        const data = await adapter.listProjects();
        if (disposed || version !== revision) return;
        if (!data || !Array.isArray(data.projects)) throw new Error('Danh sách dự án không đúng định dạng.');
        const projects = data.projects.filter((p) => p && typeof p.projectId === 'string' && typeof p.projectTitle === 'string');
        if (state.pendingCreated && !projects.some(p => p.projectId === state.pendingCreated?.projectId)) projects.unshift(state.pendingCreated);
        publish({
          projectsLoaded: true,
          projects,
          projectsError: data.error || (data.source === 'fallback' ? 'Chỉ có danh sách dự phòng; thử tải lại.' : undefined),
        });
      } catch (error) {
        if (version === revision) publish({ projects: state.pendingCreated ? [state.pendingCreated] : [], projectsLoaded: false, projectsError: errorText(error) });
      }
    })().finally(() => {
      projectsWork = undefined;
      publish({ projectsLoading: false });
      if (projectsQueued && !disposed) {
        projectsQueued = false;
        void loadProjects();
      }
    });
    return projectsWork;
  }
  function selectProject(projectId: string): Promise<void> {
    if (disposed) return Promise.resolve();
    if (selectionWork) return selectionWork;
    if (!state.projects.some((p) => p.projectId === projectId) || state.running || state.selecting) {
      publish({ projectsError: 'Không thể đổi dự án khi đang chạy, đang chọn hoặc dự án không hợp lệ.' });
      return Promise.resolve();
    }
    publish({ selecting: true, projectsError: undefined });
    selectionWork = (async () => {
      try {
        const version = revision;
        const runVersion = runtimeRevision;
        const studioOpen = await studioIsOpen().catch(() => undefined);
        publish({ studioOpen });
        if (disposed) return;
        if (state.running || version !== revision || runVersion !== runtimeRevision) {
          throw new Error('Lượt chạy hoặc dự án đã thay đổi. Kiểm tra Google Flow rồi thử lại.');
        }
        const selected = await adapter.selectProject(projectId);
        if (disposed) return;
        // ponytail: observation only; worker/Studio must share an atomic lock to prevent dispatch races.
        if (state.running || runVersion !== runtimeRevision) throw new Error('Lượt chạy đã thay đổi trong khi chọn. Dự án có thể đã đổi; kiểm tra Flow rồi thử lại.');
        if (selected.projectId !== projectId) throw new Error('Phản hồi chọn dự án không khớp.');
        revision++;
        publish({ flow: { state: 'CHECKING' }, credits: undefined });
        if (healthWork) { queued = true; await healthWork; } else await refresh();
        if (state.running || runVersion !== runtimeRevision) throw new Error('Lượt chạy đã thay đổi trong khi xác nhận dự án. Kiểm tra Flow rồi thử lại.');
        if (state.flow.projectId !== projectId || state.flow.state !== 'READY') {
          throw new Error('Google Flow chưa xác nhận dự án đã chọn. Kiểm tra thẻ Flow rồi thử lại.');
        }
        if (state.pendingCreated?.projectId === projectId) publish({ pendingCreated: undefined });
        const selectedProject = state.projects.find((project) => project.projectId === projectId);
        if (selectedProject) publishActiveProject(selectedProject);
      } catch (error) { publish({ projectsError: errorText(error) }); }
    })().finally(() => { selectionWork = undefined; publish({ selecting: false }); });
    return selectionWork;
  }
  async function createProject(title: string): Promise<void> {
    if (disposed || state.running || state.selecting) return;
    if (state.pendingCreated) return selectProject(state.pendingCreated.projectId);
    if (title.length > 100) {
      publish({ projectsError: 'Tên dự án không được vượt quá 100 ký tự.' });
      return;
    }
    // ponytail: worker requires a title; prompt-based renaming needs a Studio/backend contract.
    const cleanTitle = title.trim() || 'Dự án chưa đặt tên';
    publish({ selecting: true, projectsError: undefined });
    try {
      const runVersion = runtimeRevision;
      if (typeof adapter.createProject !== 'function') {
        throw new Error('Chức năng tạo dự án không khả dụng trên adapter hiện tại.');
      }
      const created = await adapter.createProject(cleanTitle);
      if (disposed) return;
      if (!created?.projectId) throw new Error('Không nhận được ID dự án từ máy chủ.');
      const newProj = { projectId: created.projectId, projectTitle: created.projectTitle || cleanTitle };
      publish({
        pendingCreated: newProj,
        projects: [newProj, ...state.projects.filter((p) => p.projectId !== created.projectId)],
        projectsLoaded: true,
      });
      if (state.running || runVersion !== runtimeRevision) throw new Error('Đã tạo dự án nhưng lượt chạy đã thay đổi. Thử chọn lại dự án đã tạo, không cần tạo mới.');
      publish({ selecting: false });
      await selectProject(created.projectId);
    } catch (error) {
      publish({ projectsError: errorText(error) });
    } finally {
      publish({ selecting: false });
    }
  }
  async function addCustomProject(projectIdOrUrl: string, title?: string): Promise<void> {
    if (disposed || state.running || state.selecting) return;
    const cleanId = extractProjectId(projectIdOrUrl);
    if (!cleanId) {
      publish({ projectsError: 'ID dự án hoặc URL không hợp lệ.' });
      return;
    }
    const existing = state.projects.find((p) => p.projectId === cleanId);
    if (!existing) {
      const customProj = { projectId: cleanId, projectTitle: title?.trim() || cleanId };
      publish({
        projects: [customProj, ...state.projects],
        projectsLoaded: true,
      });
    }
    await selectProject(cleanId);
  }
  function runtimeEvent(message: FlowgraphRuntimeEventMessage) {
    if (!message.kind || disposed) return;
    runtimeRevision++;
    const terminal = ['success', 'failed', 'cancelled', 'canceled'].includes(message.status ?? '') || message.kind === 'run:error';
    if (message.runId) {
      if (message.kind.startsWith('run:') && terminal) runs.delete(message.runId);
      else if (['running', 'validating', 'queued'].includes(message.status ?? '')) runs.add(message.runId);
    }
    publish({ running: runs.size > 0,
      ...(message.kind.startsWith('run:') ? { liveRun: message } : {}),
      logs: [{ id: ++logId, time: new Date().toLocaleTimeString('vi-VN'), text: formatFlowgraphRuntimeEvent(message),
        error: Boolean(message.error) || message.kind === 'run:error' || message.status === 'failed' }, ...state.logs].slice(0, 20) });
  }
  return { getSnapshot: () => state, refresh, flowChanged, loadProjects, selectProject, createProject, addCustomProject, runtimeEvent,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; revision++; queued = false; listeners.clear(); },
  };
}

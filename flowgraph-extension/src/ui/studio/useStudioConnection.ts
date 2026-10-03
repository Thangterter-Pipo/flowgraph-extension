// useStudioConnection — drives the topbar Account/Flow pills + project manager from the
// REAL state over the SW bridge (FG-0101/0102, FG-0202-0206). No hard-coded "online".
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountStatus, CreditsData, FlowStatus, ProjectInfo } from '../../shared/bridge';
import { RealGoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';


export interface RunBlockReason {
  code: string;
  message: string;
  detail?: string;
}

export interface ActiveProjectState {
  projectId: string;
  projectName: string;
  selectedAt: string;
}

/** Pure helper — no side effects. UI, runWorkflow and tests must use this exact logic for pre-click gate. */
export function computeRunBlockReason(
  account: AccountStatus,
  flow: FlowStatus,
  activeProject?: ActiveProjectState,
  runStatus?: string
): RunBlockReason | null {
  if (runStatus === 'running') {
    return { code: 'RUN_IN_PROGRESS', message: 'A workflow is already running. Click Stop to cancel before starting another.' };
  }
  if (account.state !== 'CONNECTED') {
    if (account.state === 'CHECKING') {
      return { code: 'ACCOUNT_CHECKING', message: 'Account status checking… Refresh or wait for live update.' };
    }
    if (account.state === 'ERROR') {
      return { code: 'ACCOUNT_ERROR', message: account.error || 'Account error detected. Click the account pill to refresh.' };
    }
    if (account.state === 'SESSION_EXPIRED') {
      return { code: 'AUTH_EXPIRED', message: 'Google session expired. Refresh the Google Flow tab and retry.' };
    }
    if (account.state === 'DISCONNECTED') {
      return { code: 'ACCOUNT_DISCONNECTED', message: 'Google Account disconnected. Open a Google Flow tab and sign in.' };
    }
    return { code: 'ACCOUNT_NOT_CONNECTED', message: 'Google Account not connected. Open Flow tab to authenticate.' };
  }
  if (flow.state === 'CHECKING') {
    return { code: 'FLOW_CHECKING', message: 'Flow connection checking… Click Flow pill or Run to trigger fresh health check.' };
  }
  if (flow.state === 'ERROR') {
    return { code: 'FLOW_ERROR', message: flow.error || 'Flow tab in error state. Check console in Flow tab and refresh Studio.' };
  }
  if (flow.state === 'DISCONNECTED' || !flow.url) {
    return { code: 'NO_FLOW_TAB', message: 'No Google Flow tab detected. Open https://flow.google.com/ (or labs) in another tab.' };
  }
  const liveProjectId = flow.projectId;
  if (flow.state === 'PROJECT_REQUIRED' || !liveProjectId) {
    return { code: 'FLOW_PROJECT_REQUIRED', message: 'Google Flow tab is not inside a project page. Navigate inside Flow to a project.' };
  }
  if (!activeProject?.projectId) {
    return { code: 'NO_ACTIVE_PROJECT', message: 'No project selected in Studio. Use the project dropdown or create one.' };
  }
  if (liveProjectId && activeProject.projectId !== liveProjectId) {
    return {
      code: 'PROJECT_MISMATCH',
      message: `Studio project ${activeProject.projectId.slice(0, 8)}… does not match live Flow project ${liveProjectId.slice(0, 8)}…. Re-select project or refresh.`,
      detail: `live=${liveProjectId} studio=${activeProject.projectId}`,
    };
  }
  return null; // unlocked
}


const ACTIVE_PROJECT_KEY = 'flowgraph.activeProject';
const ACCOUNT_PILL_KEY = 'flowgraph.accountStatus';
const FLOW_PILL_KEY = 'flowgraph.flowStatus';

export interface StudioConnection {
  account: AccountStatus;
  flow: FlowStatus;
  credits?: CreditsData;
  projects: ProjectInfo[];
  projectsLoading: boolean;
  projectsError?: string;
  activeProject?: ActiveProjectState;
  refreshing: boolean;
  refreshAccount: () => Promise<void>;
  refreshFlow: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (title: string) => Promise<ActiveProjectState>;
  selectProject: (projectId: string) => Promise<ActiveProjectState>;
  isCanvasUnlocked: boolean;
  runBlockReason: RunBlockReason | null;
}

const CHECKING: AccountStatus = { state: 'CHECKING' };
const FLOW_CHECKING: FlowStatus = { state: 'CHECKING' };

function loadPersistedProject(): ActiveProjectState | undefined {
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      const queryId = params.get('projectId');
      if (queryId) {
        const title = params.get('title') || 'Flow Project';
        const project: ActiveProjectState = {
          projectId: queryId,
          projectName: title,
          selectedAt: new Date().toISOString(),
        };
        localStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify(project));
        return project;
      }
    }
    const raw = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as ActiveProjectState;
    if (parsed?.projectId) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
}

function loadStatus<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useStudioConnection(): StudioConnection {
  const adapterRef = useRef<RealGoogleFlowAdapter | null>(null);
  const [account, setAccount] = useState<AccountStatus>(() => loadStatus(ACCOUNT_PILL_KEY, CHECKING));
  // A persisted READY value is display history, not proof that the current tab
  // still has the same project open. Start fail-closed and allow realtime writes
  // only after the service worker verifies the live Flow tab.
  const [flow, setFlow] = useState<FlowStatus>(FLOW_CHECKING);
  const [credits, setCredits] = useState<CreditsData | undefined>();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | undefined>();
  const [activeProject, setActiveProject] = useState<ActiveProjectState | undefined>(loadPersistedProject);
  const [refreshing, setRefreshing] = useState(false);

  const adapter = () => adapterRef.current ?? (adapterRef.current = new RealGoogleFlowAdapter());

  const refreshAccount = useCallback(async () => {
    try {
      const { account: liveAccount, flow: liveFlow, credits: liveCredits } = await adapter().healthCheck();
      setAccount(liveAccount);
      setFlow(liveFlow);
      setCredits(liveCredits);
      localStorage.setItem(ACCOUNT_PILL_KEY, JSON.stringify(liveAccount));
      localStorage.setItem(FLOW_PILL_KEY, JSON.stringify(liveFlow));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAccount({ state: 'ERROR', error: message });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshFlow = useCallback(async () => {
    try {
      const status = await adapter().healthCheck();
      setFlow(status.flow);
      localStorage.setItem(FLOW_PILL_KEY, JSON.stringify(status.flow));

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFlow({ state: 'ERROR', error: message });
    }
  }, [activeProject]);

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(undefined);
    try {
      const knownProjectsMap = new Map<string, ProjectInfo>();

      // Chỉ trích xuất và hiển thị các dự án của tài khoản đang được kết nối thực tế
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
          const flowTab = tabs[0];
          if (flowTab?.id) {
            const injected = await chrome.scripting.executeScript({
              target: { tabId: flowTab.id },
              func: () => {
                const list: Array<{ id: string; title: string; thumbnailUrl?: string }> = [];
                const regex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

                // 1. Quét toàn bộ project cards trên trang flow.google.com
                const cards = Array.from(document.querySelectorAll('flow-project-card'));
                for (const c of cards) {
                  const a = c.querySelector('a.project-thumbnail-container');
                  const footer = c.querySelector('.project-card-footer') as HTMLElement | null;
                  const img = c.querySelector('img') as HTMLImageElement | null;
                  const href = a ? a.getAttribute('href') : '';
                  const m = href ? href.match(regex) : null;
                  if (m) {
                    const id = m[0].toLowerCase();
                    let title = footer ? (footer.innerText || footer.textContent || '').split('\n')[0].trim() : '';
                    title = title.replace(/\b(edit|delete|add)\b/gi, '').trim();
                    const thumbnailUrl = img?.getAttribute('src') || img?.currentSrc || undefined;
                    if (!list.some((item) => item.id === id)) {
                      list.push({ id, title: title || 'Untitled Project', thumbnailUrl });
                    }
                  }
                }

                // 2. Nếu đang ở trong trang project cụ thể (/project/:id), nạp thêm nếu chưa có
                const pathMatch = location.pathname.match(/\/project\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
                if (pathMatch && pathMatch[1]) {
                  const currentId = pathMatch[1].toLowerCase();
                  if (!list.some((item) => item.id === currentId)) {
                    let docTitle = document.title.replace(/^Google Flow\s*[–—-]\s*/i, '').trim();
                    if (!docTitle || docTitle.toLowerCase() === 'new project') {
                      docTitle = 'Dự án Hiện tại (new project)';
                    }
                    list.unshift({ id: currentId, title: docTitle });
                  }
                }

                return list;
              },
            });
            const scraped = injected?.[0]?.result;
            if (Array.isArray(scraped)) {
              for (const s of scraped) {
                if (s.id) {
                  knownProjectsMap.set(s.id, { projectId: s.id, projectTitle: s.title, thumbnailUrl: s.thumbnailUrl });
                }
              }
            }
          }
        }
      } catch {}

      // 3. Quét các key lưu workflow trong localStorage nhưng CHỈ LẤY những project có format UUID hợp lệ
      try {
        const cachedRaw = localStorage.getItem('flowgraph.cachedProjects.v1');
        if (cachedRaw) {
          const cachedList = JSON.parse(cachedRaw);
          if (Array.isArray(cachedList)) {
            for (const p of cachedList) {
              if (p?.projectId && !knownProjectsMap.has(p.projectId)) {
                knownProjectsMap.set(p.projectId, p);
              }
            }
          }
        }
      } catch {}

      // Nếu tab Flow quét được danh sách mới (khi ở trang chủ flow.google.com)
      if (knownProjectsMap.size > 0) {
        const list = Array.from(knownProjectsMap.values());
        setProjects(list);
        try {
          // Lưu cache danh sách dự án của tài khoản này
          if (list.length > 1) {
            localStorage.setItem('flowgraph.cachedProjects.v1', JSON.stringify(list));
          }
        } catch {}
        return;
      }

      // Fallback: Nếu không đọc được từ tab, chỉ dùng activeProject hiện tại nếu khớp ID của tab
      const currentActive = loadPersistedProject();
      if (currentActive?.projectId) {
        knownProjectsMap.set(currentActive.projectId, {
          projectId: currentActive.projectId,
          projectTitle: currentActive.projectName || 'Dự án Hiện tại',
        });
      }
      setProjects(Array.from(knownProjectsMap.values()));
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  // Live gate reactivity: the service worker broadcasts FLOWGRAPH_EVENT whenever the
  // Google Flow tab navigates (project -> home, home -> project, tab URL change). We
  // apply the pushed real flow state immediately so the canvas gate locks/unlocks
  // without waiting for the 120s poll or a manual reload. This never force-enables
  // the project gate; it only reflects the live Flow tab state.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const listener = (message: { type?: string; payload?: { flow?: FlowStatus } }) => {
      if (message?.type !== 'FLOWGRAPH_EVENT' || !message.payload?.flow) return;
      const liveFlow = message.payload.flow;
      setFlow(liveFlow);
      localStorage.setItem(FLOW_PILL_KEY, JSON.stringify(liveFlow));
      if (liveFlow.projectId) {
        setActiveProject((current) => {
          if (current?.projectId === liveFlow.projectId) return current;
          const selected: ActiveProjectState = {
            projectId: liveFlow.projectId!,
            projectName: liveFlow.title?.replace(/^Google Flow\s*[-–]\s*/i, '').trim() || 'Flow project',
            selectedAt: new Date().toISOString(),
          };
          persistActiveProject(selected);
          return selected;
        });
      }
      // Re-read the live account state too. After a service-worker reload the
      // content-script relay is rebuilt lazily, so the pushed flow state alone
      // is not enough to clear a stale ERROR account pill; we reconcile both so
      // the canvas gate unlocks as soon as the real bridge is healthy again.
      void refreshAccount();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshAccount]);

  // Sidepanel và Studio là hai document khác nhau. StorageEvent là tín hiệu
  // realtime nhẹ, dùng để chuyển Project đã chọn mà không chờ polling.
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key !== ACTIVE_PROJECT_KEY) return;
      if (!event.newValue) {
        setActiveProject(undefined);
        return;
      }
      try {
        const next = JSON.parse(event.newValue) as ActiveProjectState;
        if (next?.projectId && next?.projectName) setActiveProject(next);
      } catch {
        // Bỏ qua payload hỏng; không mở khóa Studio bằng dữ liệu không hợp lệ.
      }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, []);

  const selectProject = useCallback(async (projectId: string): Promise<ActiveProjectState> => {
    const project = projects.find((candidate) => candidate.projectId === projectId);
    const selected: ActiveProjectState = {
      projectId,
      projectName: project?.projectTitle ?? projectId,
      selectedAt: new Date().toISOString(),
    };
    try {
      await adapter().selectProject(projectId);
    } catch (error) {
      // SW select is a memory-only confirm; keep going even if the confirm roundtrip failed.
      console.warn('Project select confirm failed:', error);
    }
    setActiveProject(selected);
    persistActiveProject(selected);
    return selected;
  }, [projects]);

  const createProject = useCallback(async (title: string): Promise<ActiveProjectState> => {
    const created = await adapter().createProject(title);
    const selected: ActiveProjectState = {
      projectId: created.projectId,
      projectName: created.projectTitle,
      selectedAt: new Date().toISOString(),
    };
    setActiveProject(selected);
    persistActiveProject(selected);
    await refreshProjects();
    return selected;
  }, [refreshProjects]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await refreshAccount();
    await refreshProjects();
  }, [refreshAccount, refreshProjects]);

  useEffect(() => {
    void refreshAll();
    const timer = window.setInterval(() => {
      void refreshAccount();
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [refreshAccount, refreshAll]);

  const blockReason = computeRunBlockReason(account, flow, activeProject);
  const isCanvasUnlocked = blockReason === null;


  return {
    account,
    flow,
    credits,
    projects,
    projectsLoading,
    projectsError,
    activeProject,
    refreshing,
    refreshAccount,
    refreshFlow,
    refreshProjects,
    createProject,
    selectProject,
    isCanvasUnlocked,
    runBlockReason: blockReason,
  };
}

function persistActiveProject(project: ActiveProjectState): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify(project));
  } catch {
    // storage may be unavailable; active project stays in memory for this session.
  }
}

// useStudioConnection — drives the topbar Account/Flow pills + project manager from the
// REAL state over the SW bridge (FG-0101/0102, FG-0202-0206). No hard-coded "online".
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountStatus, CreditsData, FlowStatus, ProjectInfo } from '../../shared/bridge';
import { RealGoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';

export interface ActiveProjectState {
  projectId: string;
  projectName: string;
  selectedAt: string;
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
}

const CHECKING: AccountStatus = { state: 'CHECKING' };
const FLOW_CHECKING: FlowStatus = { state: 'CHECKING' };

function loadPersistedProject(): ActiveProjectState | undefined {
  try {
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
      if (status.flow.projectId && !activeProject) {
        setActiveProject({
          projectId: status.flow.projectId,
          projectName: 'Flow project',
          selectedAt: new Date().toISOString(),
        });
        persistActiveProject({ projectId: status.flow.projectId, projectName: 'Flow project', selectedAt: new Date().toISOString() });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFlow({ state: 'ERROR', error: message });
    }
  }, [activeProject]);

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(undefined);
    try {
      const data = await adapter().listProjects();
      setProjects(data.projects);
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

  const isCanvasUnlocked = account.state === 'CONNECTED' && (flow.state === 'READY' || flow.state === 'CONNECTED') && Boolean(activeProject?.projectId);

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
  };
}

function persistActiveProject(project: ActiveProjectState): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify(project));
  } catch {
    // storage may be unavailable; active project stays in memory for this session.
  }
}

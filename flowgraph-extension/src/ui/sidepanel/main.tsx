import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  ChevronRight,
  CircleUserRound,
  CloudDownload,
  FolderOpen,
  Gauge,
  History,
  Network,
  Play,
  RefreshCcw,
  Settings,
  Terminal,
  Unplug,
  Workflow,
} from 'lucide-react';
import '../theme.css';
import { applyStoredTheme, THEME_SETTINGS_STORAGE_KEY } from '../themeSystem';
import { formatFlowgraphRuntimeEvent, shouldRefreshLastRun } from './runtimeEventLog';
import { RealGoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import type { AccountStatus, FlowStatus, CreditsData, RuntimeEvent } from '../../shared/bridge';

type ConnectionStage = 'checking' | 'signed-out' | 'flow-disconnected' | 'connected';

const adapter = new RealGoogleFlowAdapter();

// Apply the shared Studio theme before React paints the Side Panel.
applyStoredTheme();

function MiniGraph() {
  return (
    <div className="mini-graph" aria-hidden="true">
      <div className="mini-node purple">Prompt</div>
      <div className="mini-node blue">Gemini</div>
      <div className="mini-node green">Image → Video</div>
      <div className="mini-node orange">Download</div>
      <div className="mini-wire w1" />
      <div className="mini-wire w2" />
      <div className="mini-wire w3" />
    </div>
  );
}

async function openTab(url: string) {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((candidate) => candidate.id !== undefined && (
        candidate.url?.includes('labs.google/fx') || candidate.url?.includes('flow.google.com')
      ));
      if (tab?.id !== undefined) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined) {
          // A focus failure must not open a duplicate after activation succeeds.
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
        return;
      }
      await chrome.tabs.create({ url });
      return;
    }
  } catch {
    // Fallback to browser preview behavior.
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function Header({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing?: boolean }) {
  return (
    <header className="sidepanel-header">
      <div className="fg-brand">
        <div className="fg-logo"><Workflow size={19} /></div>
        <div className="fg-brand-title">FlowGraph</div>
        <span className="fg-version">v0.1</span>
      </div>
      <button className="fg-btn fg-btn-ghost fg-icon-btn" title="Refresh connection" onClick={onRefresh} disabled={isRefreshing}>
        <RefreshCcw size={16} className={isRefreshing ? 'spin' : ''} />
      </button>
    </header>
  );
}

function CheckingConnection() {
  return (
    <section className="sidepanel-checking fg-card" role="status" aria-live="polite">
      <RefreshCcw size={22} className="spin" />
      <div>
        <strong>Đang kiểm tra Google Flow</strong>
        <span>Đang xác nhận tài khoản, phiên Flow và project hiện tại…</span>
      </div>
    </section>
  );
}

function SignedOut({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <section className="sidepanel-hero fg-card">
        <div className="fg-kicker">Visual AI workflow</div>
        <h1>Build AI <span>workflows</span> for Google Flow</h1>
        <p>Visualize. Automate. Create. Connect prompt, image and video generation with a reusable node-based workflow.</p>
        <MiniGraph />
        <button className="fg-btn fg-btn-primary" style={{ width: '100%', minHeight: 44 }} onClick={onContinue}>
          <CircleUserRound size={17} /> Continue with Google
        </button>
      </section>

      <section className="setup-steps fg-card">
        <div className="section-head" style={{ marginBottom: 3 }}><h3>Get started in 3 steps</h3></div>
        <div className="setup-step">
          <span className="step-index">1</span>
          <div><div className="step-title">Connect Google Account</div><div className="step-sub">Use the signed-in Google Flow session</div></div>
          <span className="fg-status-dot warn" />
        </div>
        <div className="setup-step">
          <span className="step-index">2</span>
          <div><div className="step-title">Connect Google Flow</div><div className="step-sub">Link your authorized Flow session</div></div>
          <span className="fg-status-dot" />
        </div>
        <div className="setup-step">
          <span className="step-index">3</span>
          <div><div className="step-title">Open Workflow Studio</div><div className="step-sub">Build your first graph visually</div></div>
          <span className="fg-status-dot" />
        </div>
      </section>
    </>
  );
}

function FlowDisconnected({
  account,
  flow,
  onCheckConnection,
  onOpenStudio,
  isRefreshing,
}: {
  account: AccountStatus;
  flow: FlowStatus;
  onCheckConnection: () => void;
  onOpenStudio: () => void;
  isRefreshing?: boolean;
}) {
  const isAccountReady = account.state === 'CONNECTED';
  const isFlowReady = flow.state === 'READY';
  const isProjectReady = Boolean(flow.projectId);
  const accountEmail = account.email || (isAccountReady ? 'Google Account Connected' : 'Not signed in');
  const flowStateText = isFlowReady ? 'Connected' : flow.state === 'CHECKING' ? 'Checking…' : 'Not connected';
  const projectText = flow.projectId ? (flow.title ? flow.title.replace(/^Google Flow\s*[-–]\s*/i, '').trim() : flow.projectId) : 'None / Select in Flow';

  return (
    <>
      <div>
        <div className="fg-kicker">Connection setup</div>
        <p className="fg-muted" style={{ fontSize: 11, lineHeight: 1.5, margin: '6px 0 0' }}>Connect your Google account and current Flow browser session before running workflows.</p>
      </div>

      <div className="connection-grid">
        <section className={`connection-card ${isAccountReady ? 'connected' : 'disconnected'} fg-card`}>
          <div className="top">
            <CircleUserRound size={18} color={isAccountReady ? 'var(--green)' : 'var(--purple)'} />
            <span className={`fg-badge ${isAccountReady ? 'success' : ''}`}>{isAccountReady ? 'Connected' : 'Offline'}</span>
          </div>
          <div className="title">Google Account</div>
          <div className="value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accountEmail}</div>
        </section>
        <section className={`connection-card ${isFlowReady ? 'connected' : 'disconnected'} fg-card`}>
          <div className="top">
            <Unplug size={18} color={isFlowReady ? 'var(--green)' : 'var(--purple)'} />
            <span className={`fg-badge ${isFlowReady ? 'success' : ''}`}>{isFlowReady ? 'Connected' : 'Offline'}</span>
          </div>
          <div className="title">Google Flow</div>
          <div className="value">{flowStateText}</div>
        </section>
        <section className={`connection-card ${isProjectReady ? 'connected' : 'disconnected'} fg-card`}>
          <div className="top">
            <FolderOpen size={18} color={isProjectReady ? 'var(--blue)' : 'var(--muted)'} />
            <span className={`fg-badge ${isProjectReady ? 'success' : ''}`}>{isProjectReady ? 'Detected' : 'Required'}</span>
          </div>
          <div className="title">Active Project</div>
          <div className="value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectText}</div>
        </section>
      </div>

      <section className="connection-banner fg-card">
        <h3>Connect Google Flow</h3>
        <p>The extension will use the authorized Google Flow tab as its generation runtime. No Flow password, cookie or reCAPTCHA token is stored in workflow data.</p>
        <button className="fg-btn fg-btn-primary" onClick={() => openTab('https://flow.google.com')}><ArrowRight size={15} /> Open Google Flow</button>
        <button className="fg-btn" onClick={onCheckConnection} disabled={isRefreshing}><RefreshCcw size={14} className={isRefreshing ? 'spin' : ''} /> Recheck Connection</button>
      </section>

      <section className="dashboard-section fg-card">
        <div className="section-head"><h3>Connection requirements</h3><Settings size={14} className="fg-muted" /></div>
        <div className="log-list">
          <div className="log-row">
            <span className={`fg-status-dot ${isAccountReady ? 'online' : 'warn'}`} />
            <strong>Google account</strong>
            <span>{isAccountReady ? 'Ready' : 'Required'}</span>
          </div>
          <div className="log-row">
            <span className={`fg-status-dot ${isFlowReady ? 'online' : 'warn'}`} />
            <strong>Flow session</strong>
            <span>{isFlowReady ? 'Ready' : 'Required'}</span>
          </div>
          <div className="log-row">
            <span className={`fg-status-dot ${flow.projectId ? 'online' : ''}`} />
            <strong>Active project</strong>
            <span>{flow.projectId ? 'Detected' : 'Required'}</span>
          </div>
        </div>
      </section>

      <button className="fg-btn fg-btn-primary" disabled={!isAccountReady || !isFlowReady} onClick={onOpenStudio}><Workflow size={15} /> Open Workflow Studio</button>
    </>
  );
}

function Connected({
  account,
  flow,
  credits,
  projectName,
  onOpenStudio,
}: {
  account: AccountStatus;
  flow: FlowStatus;
  credits?: CreditsData;
  projectName: string;
  onOpenStudio: () => void;
}) {
  const [logs, setLogs] = useState<Array<{ id: string; time: string; text: string; level: 'info' | 'success' | 'warn' | 'error' }>>([]);
  const [lastRun, setLastRun] = useState<{ title: string; meta: string; status: string } | null>(null);

  const loadLastRun = useCallback(() => {
    try {
      const historyRaw = localStorage.getItem('flowgraph.runHistory.v1') || localStorage.getItem('flowgraph.runHistory');
      if (historyRaw) {
        const parsed = JSON.parse(historyRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const latest = parsed[0];
          const isSuccess = latest.status === 'success' || latest.state === 'success';
          const isCancelled = latest.status === 'cancelled' || latest.state === 'cancelled';
          const timeStr = latest.finishedAt || latest.startedAt || latest.timestamp;
          setLastRun({
            title: latest.workflowName || latest.projectName || projectName || 'Workflow Run',
            meta: `${isSuccess ? 'Completed' : 'Finished'} · ${timeStr ? new Date(timeStr).toLocaleTimeString() : 'Recently'}`,
            status: isSuccess ? 'Done' : isCancelled ? 'Canceled' : 'Failed',
          });
        }
      }
    } catch {}
  }, [projectName]);

  useEffect(() => {
    loadLastRun();
  }, [loadLastRun]);

  // Live Runtime Event listener (SP-04 & SP-05): listen to runtime events broadcasted from service worker or Studio
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const listener = (message: { type?: string; kind?: string; runId?: string; nodeId?: string; status?: string; error?: { message?: string }; payload?: { flow?: FlowStatus } }) => {
      if (message?.type !== 'FLOWGRAPH_EVENT') return;
      // Skip flow tab state change events broadcasted by SW
      if (message.payload?.flow) return;
      if (!message.kind) return;

      const now = new Date().toLocaleTimeString();
      const eventText = formatFlowgraphRuntimeEvent(message);
      const level: 'info' | 'success' | 'warn' | 'error' =
        message.kind === 'run:error' ? 'error' :
        message.status === 'success' ? 'success' :
        message.status === 'failed' ? 'error' : 'info';

      setLogs((prev) => [{
        id: crypto.randomUUID(),
        time: now,
        text: eventText,
        level,
      }, ...prev].slice(0, 20));

      if (shouldRefreshLastRun(message)) {
        loadLastRun();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [loadLastRun]);

  const creditText = credits?.credits !== undefined ? String(credits.credits) : credits?.serviceTier ? credits.serviceTier.replace('SERVICE_TIER_', '') : 'Unlimited / Free';
  const accountEmail = account.email || 'Connected';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="fg-kicker">Connected control center</div>
        <span className="fg-badge success"><span className="fg-status-dot online" /> Connected</span>
      </div>

      <div className="connection-grid">
        <section className="connection-card connected fg-card">
          <div className="top"><CircleUserRound size={18} color="#62e49e" /><ChevronRight size={14} className="fg-muted" /></div>
          <div className="title">Google Account</div><div className="value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accountEmail}</div>
        </section>
        <section className="connection-card connected fg-card">
          <div className="top"><Network size={18} color="#62e49e" /><ChevronRight size={14} className="fg-muted" /></div>
          <div className="title">Google Flow</div><div className="value">Connected</div>
        </section>
        <section className="connection-card fg-card">
          <div className="top"><FolderOpen size={18} color="#68aaff" /><span className="fg-version">Active</span></div>
          <div className="title">Current Project</div><div className="value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName}</div>
        </section>
        <section className="connection-card fg-card">
          <div className="top"><Gauge size={18} color="#ffad5d" /><span className="fg-badge ready">Live</span></div>
          <div className="title">Available Credits</div><div className="value">{creditText}</div>
        </section>
      </div>

      {lastRun && (
        <section className="dashboard-section fg-card">
          <div className="section-head"><h3>Last Run Summary</h3><ChevronRight size={14} className="fg-muted" /></div>
          <div className="last-run">
            <div className="last-run-status-thumb" aria-hidden="true"><History size={18} /></div>
            <div>
              <div className="run-title">{lastRun.title}</div>
              <div className="run-meta">{lastRun.meta}</div>
            </div>
            <span className={`fg-badge ${lastRun.status === 'Done' ? 'success' : 'warn'}`}>{lastRun.status}</span>
          </div>
        </section>
      )}

      {logs.length > 0 && (
        <section className="dashboard-section fg-card">
          <div className="section-head">
            <h3>Live Execution Log</h3>
            <Terminal size={14} className="fg-muted" />
          </div>
          <div className="log-list" style={{ maxHeight: 160, overflowY: 'auto' }}>
            {logs.map((log) => (
              <div key={log.id} className="log-row" style={{ fontSize: 11, padding: '4px 0' }}>
                <span className={`fg-status-dot ${log.level === 'success' ? 'online' : log.level === 'error' ? 'warn' : ''}`} />
                <span style={{ color: 'var(--fg-text-muted)', minWidth: 55 }}>{log.time}</span>
                <span style={{ flex: 1, wordBreak: 'break-word' }}>{log.text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-section fg-card">
        <div className="section-head"><h3>Quick Actions</h3></div>
        <div className="quick-actions">
          <button className="fg-btn quick-action primary" onClick={onOpenStudio}><Workflow size={18} /><span>Open Studio</span></button>
          <button className="fg-btn quick-action" onClick={() => openTab('https://flow.google.com')}><Play size={18} color="#62aaff" /><span>Flow Web</span></button>
          <button className="fg-btn quick-action" onClick={() => {
            try {
              if (typeof chrome !== 'undefined' && chrome.downloads) {
                chrome.downloads.showDefaultFolder();
              }
            } catch {}
          }}><CloudDownload size={18} /><span>Downloads</span></button>
        </div>
      </section>
    </>
  );
}

function App() {
  const [account, setAccount] = useState<AccountStatus>({ state: 'CHECKING' });
  const [flow, setFlow] = useState<FlowStatus>({ state: 'CHECKING' });
  const [credits, setCredits] = useState<CreditsData | undefined>();
  const [projectName, setProjectName] = useState<string>('Flow project');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === THEME_SETTINGS_STORAGE_KEY) applyStoredTheme();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Derive connection stage strictly from real account + flow status
  const stage: ConnectionStage =
    account.state === 'CHECKING' || flow.state === 'CHECKING'
      ? 'checking'
      : account.state !== 'CONNECTED'
      ? 'signed-out'
      : flow.state !== 'READY'
      ? 'flow-disconnected'
      : 'connected';

  const checkLiveStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const health = await adapter.healthCheck();
      setAccount(health.account);
      setFlow(health.flow);
      setCredits(health.credits);

      if (health.flow.title) {
        setProjectName(health.flow.title.replace(/^Google Flow\s*[-–]\s*/i, '').trim() || 'Flow project');
      }
    } catch {
      // Keep fail-closed state
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void checkLiveStatus();
    const timer = setInterval(() => void checkLiveStatus(), 2500);
    return () => clearInterval(timer);
  }, [checkLiveStatus]);

  const openStudio = async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && chrome.tabs?.create) {
        await chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') });
        return;
      }
    } catch {
      // Browser preview fallback below.
    }
    window.open('./studio.html', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fg-shell sidepanel-app">
      <Header onRefresh={checkLiveStatus} isRefreshing={isRefreshing} />
      {stage === 'checking' && <CheckingConnection />}
      {stage === 'signed-out' && (
        <SignedOut onContinue={() => openTab('https://flow.google.com')} />
      )}
      {stage === 'flow-disconnected' && (
        <FlowDisconnected
          account={account}
          flow={flow}
          onCheckConnection={checkLiveStatus}
          onOpenStudio={openStudio}
          isRefreshing={isRefreshing}
        />
      )}
      {stage === 'connected' && (
        <Connected
          account={account}
          flow={flow}
          credits={credits}
          projectName={projectName}
          onOpenStudio={openStudio}
        />
      )}
      <footer className="sidepanel-footer"><span>FlowGraph v0.1</span><span>Live Companion · MV3</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

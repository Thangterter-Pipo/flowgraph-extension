import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleUserRound,
  CloudDownload,
  FileJson,
  FolderOpen,
  Gauge,
  History,
  Image,
  LayoutTemplate,
  LogOut,
  Network,
  Play,
  RefreshCcw,
  Settings,
  Sparkles,
  Unplug,
  Video,
  WandSparkles,
  Workflow,
  X,
} from 'lucide-react';
import '../theme.css';
import { RealGoogleFlowAdapter } from '../../adapters/google-flow/GoogleFlowAdapter';
import type { AccountStatus, FlowStatus, CreditsData } from '../../shared/bridge';

type ConnectionStage = 'signed-out' | 'flow-disconnected' | 'connected';

const storageKey = 'flowgraph.ui.connectionStage';
const adapter = new RealGoogleFlowAdapter();

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

async function persistStage(stage: ConnectionStage) {
  localStorage.setItem(storageKey, stage);
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [storageKey]: stage });
    }
  } catch {
    // UI must remain usable in normal browser preview mode.
  }
}

async function openTab(url: string) {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      await chrome.tabs.create({ url });
      return;
    }
  } catch {
    // Fallback to browser preview behavior.
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function Header({ onReset }: { onReset: () => void }) {
  return (
    <header className="sidepanel-header">
      <div className="fg-brand">
        <div className="fg-logo"><Workflow size={19} /></div>
        <div className="fg-brand-title">FlowGraph</div>
        <span className="fg-version">v0.1</span>
      </div>
      <button className="fg-btn fg-btn-ghost fg-icon-btn" title="Reset demo state" onClick={onReset}>
        <X size={16} />
      </button>
    </header>
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

      <div className="sidepanel-stack">
        <button className="fg-btn side-action">
          <FileJson size={18} color="#65aaff" />
          <span className="side-action-copy">
            <span className="side-action-title">Import Workflow</span>
            <span className="side-action-sub">Bring in a FlowGraph JSON file</span>
          </span>
          <ChevronRight size={15} />
        </button>
        <button className="fg-btn side-action">
          <LayoutTemplate size={18} color="#ad6bff" />
          <span className="side-action-copy">
            <span className="side-action-title">View Templates</span>
            <span className="side-action-sub">Explore ready-to-run workflows</span>
          </span>
          <ChevronRight size={15} />
        </button>
      </div>

      <section className="setup-steps fg-card">
        <div className="section-head" style={{ marginBottom: 3 }}><h3>Get started in 3 steps</h3></div>
        <div className="setup-step done">
          <span className="step-index">1</span>
          <div><div className="step-title">Sign in to Extension</div><div className="step-sub">Secure Google account identity</div></div>
          <Check size={14} color="#46d98c" />
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
}: {
  account: AccountStatus;
  flow: FlowStatus;
  onCheckConnection: () => void;
  onOpenStudio: () => void;
}) {
  const isAccountReady = account.state === 'CONNECTED';
  const isFlowReady = flow.state === 'READY';
  const accountEmail = account.email || (isAccountReady ? 'Google Account Connected' : 'Not signed in');
  const flowStateText = isFlowReady ? 'Connected' : flow.state === 'CHECKING' ? 'Checking…' : 'Not connected';

  return (
    <>
      <div>
        <div className="fg-kicker">Connection setup</div>
        <p className="fg-muted" style={{ fontSize: 11, lineHeight: 1.5, margin: '6px 0 0' }}>Connect your Google account and current Flow browser session before running workflows.</p>
      </div>

      <div className="connection-grid">
        <section className={`connection-card ${isAccountReady ? 'connected' : 'disconnected'} fg-card`}>
          <div className="top">
            <CircleUserRound size={18} color={isAccountReady ? '#62e49e' : '#aa66ff'} />
            <span className={`fg-badge ${isAccountReady ? 'success' : ''}`}>{isAccountReady ? 'Connected' : 'Offline'}</span>
          </div>
          <div className="title">Google Account</div>
          <div className="value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accountEmail}</div>
        </section>
        <section className={`connection-card ${isFlowReady ? 'connected' : 'disconnected'} fg-card`}>
          <div className="top">
            <Unplug size={18} color={isFlowReady ? '#62e49e' : '#aa66ff'} />
            <span className={`fg-badge ${isFlowReady ? 'success' : ''}`}>{isFlowReady ? 'Connected' : 'Offline'}</span>
          </div>
          <div className="title">Google Flow</div>
          <div className="value">{flowStateText}</div>
        </section>
      </div>

      <section className="connection-banner fg-card">
        <h3>Connect Google Flow</h3>
        <p>The extension will use the authorized Google Flow tab as its generation runtime. No Flow password, cookie or reCAPTCHA token is stored in workflow data.</p>
        <button className="fg-btn fg-btn-primary" onClick={() => openTab('https://flow.google.com')}><ArrowRight size={15} /> Open Google Flow</button>
        <button className="fg-btn" onClick={onCheckConnection}><RefreshCcw size={14} /> Recheck Connection</button>
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
  onDisconnect,
}: {
  account: AccountStatus;
  flow: FlowStatus;
  credits?: CreditsData;
  projectName: string;
  onOpenStudio: () => void;
  onDisconnect: () => void;
}) {
  const [logs, setLogs] = useState<Array<[string, string]>>([]);
  const [lastRun, setLastRun] = useState<{ title: string; meta: string; status: string } | null>(null);

  useEffect(() => {
    try {
      const historyRaw = localStorage.getItem('flowgraph.runHistory');
      if (historyRaw) {
        const parsed = JSON.parse(historyRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const latest = parsed[0];
          setLastRun({
            title: latest.workflowName || latest.projectName || projectName || 'Workflow Run',
            meta: `${latest.state === 'success' ? 'Completed' : 'Finished'} · ${new Date(latest.timestamp || Date.now()).toLocaleTimeString()}`,
            status: latest.state === 'success' ? 'Done' : latest.state === 'cancelled' ? 'Canceled' : 'Failed',
          });
        }
      }
    } catch {}
  }, [projectName]);

  const creditText = credits?.credits !== undefined ? String(credits.credits) : 'Available';
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
            <div className="preview-thumb" />
            <div>
              <div className="run-title">{lastRun.title}</div>
              <div className="run-meta">{lastRun.meta}</div>
            </div>
            <span className={`fg-badge ${lastRun.status === 'Done' ? 'success' : 'warn'}`}>{lastRun.status}</span>
          </div>
        </section>
      )}

      <section className="dashboard-section fg-card">
        <div className="section-head"><h3>Quick Actions</h3></div>
        <div className="quick-actions">
          <button className="fg-btn quick-action primary" onClick={onOpenStudio}><Workflow size={18} /><span>Open Studio</span></button>
          <button className="fg-btn quick-action" onClick={() => openTab('https://flow.google.com')}><Play size={18} color="#62aaff" /><span>Flow Web</span></button>
          <button className="fg-btn quick-action" onClick={onOpenStudio}><Sparkles size={18} color="#5be0ab" /><span>New Graph</span></button>
          <button className="fg-btn quick-action" onClick={() => {
            try {
              if (typeof chrome !== 'undefined' && chrome.downloads) {
                chrome.downloads.showDefaultFolder();
              }
            } catch {}
          }}><CloudDownload size={18} /><span>Downloads</span></button>
        </div>
      </section>

      <button className="fg-btn fg-btn-danger" onClick={onDisconnect}><LogOut size={14} /> Disconnect Flow</button>
    </>
  );
}

function App() {
  const [stage, setStage] = useState<ConnectionStage>('signed-out');
  const [account, setAccount] = useState<AccountStatus>({ state: 'CHECKING' });
  const [flow, setFlow] = useState<FlowStatus>({ state: 'CHECKING' });
  const [credits, setCredits] = useState<CreditsData | undefined>();
  const [projectName, setProjectName] = useState<string>('Flow project');

  const checkLiveStatus = useCallback(async () => {
    try {
      const health = await adapter.healthCheck();
      setAccount(health.account);
      setFlow(health.flow);
      setCredits(health.credits);

      if (health.flow.state === 'READY' && health.account.state === 'CONNECTED') {
        setStage('connected');
        void persistStage('connected');
      } else if (health.account.state === 'CONNECTED') {
        setStage('flow-disconnected');
        void persistStage('flow-disconnected');
      }

      if (health.flow.title) {
        setProjectName(health.flow.title.replace(/^Google Flow\s*[-–]\s*/i, '').trim() || 'Flow project');
      }
    } catch {
      // Keep fail-closed or preview state
    }
  }, []);

  useEffect(() => {
    const local = localStorage.getItem(storageKey) as ConnectionStage | null;
    if (local) setStage(local);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(storageKey).then((result) => {
          const stored = result[storageKey] as ConnectionStage | undefined;
          if (stored) setStage(stored);
        });
      }
    } catch {
      // Browser preview mode.
    }

    void checkLiveStatus();
    const timer = setInterval(() => void checkLiveStatus(), 4000);
    return () => clearInterval(timer);
  }, [checkLiveStatus]);

  const changeStage = (next: ConnectionStage) => {
    setStage(next);
    void persistStage(next);
  };

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
      <Header onReset={() => changeStage('signed-out')} />
      {stage === 'signed-out' && <SignedOut onContinue={() => changeStage('flow-disconnected')} />}
      {stage === 'flow-disconnected' && (
        <FlowDisconnected
          account={account}
          flow={flow}
          onCheckConnection={checkLiveStatus}
          onOpenStudio={openStudio}
        />
      )}
      {stage === 'connected' && (
        <Connected
          account={account}
          flow={flow}
          credits={credits}
          projectName={projectName}
          onOpenStudio={openStudio}
          onDisconnect={() => changeStage('flow-disconnected')}
        />
      )}
      <footer className="sidepanel-footer"><span>FlowGraph v0.1</span><span>Live Companion · MV3</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

import React, { useEffect, useState } from 'react';
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

type ConnectionStage = 'signed-out' | 'flow-disconnected' | 'connected';

const storageKey = 'flowgraph.ui.connectionStage';

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

function FlowDisconnected({ onConnect, onOpenStudio }: { onConnect: () => void; onOpenStudio: () => void }) {
  return (
    <>
      <div>
        <div className="fg-kicker">Connection setup</div>
        <p className="fg-muted" style={{ fontSize: 11, lineHeight: 1.5, margin: '6px 0 0' }}>Connect your Google account and current Flow browser session before running workflows.</p>
      </div>

      <div className="connection-grid">
        <section className="connection-card connected fg-card">
          <div className="top"><CircleUserRound size={18} color="#62e49e" /><span className="fg-badge success">Connected</span></div>
          <div className="title">Google Account</div><div className="value">creator@gmail.com</div>
        </section>
        <section className="connection-card disconnected fg-card">
          <div className="top"><Unplug size={18} color="#aa66ff" /><span className="fg-badge">Offline</span></div>
          <div className="title">Google Flow</div><div className="value">Not connected</div>
        </section>
      </div>

      <section className="connection-banner fg-card">
        <h3>Connect Google Flow</h3>
        <p>The extension will use the authorized Google Flow tab as its generation runtime. No Flow password, cookie or reCAPTCHA token is stored in workflow data.</p>
        <button className="fg-btn fg-btn-primary" onClick={() => openTab('https://labs.google/fx/tools/flow')}><ArrowRight size={15} /> Open Google Flow</button>
        <button className="fg-btn" onClick={onConnect}><RefreshCcw size={14} /> Recheck Connection</button>
      </section>

      <section className="dashboard-section fg-card">
        <div className="section-head"><h3>Connection requirements</h3><Settings size={14} className="fg-muted" /></div>
        <div className="log-list">
          <div className="log-row"><span className="fg-status-dot online" /><strong>Google account</strong><span>Ready</span></div>
          <div className="log-row"><span className="fg-status-dot warn" /><strong>Flow session</strong><span>Required</span></div>
          <div className="log-row"><span className="fg-status-dot" /><strong>Active project</strong><span>Detected after connection</span></div>
        </div>
      </section>

      <button className="fg-btn fg-btn-primary" disabled onClick={onOpenStudio}><Workflow size={15} /> Open Workflow Studio</button>
    </>
  );
}

function Connected({ onOpenStudio, onDisconnect }: { onOpenStudio: () => void; onDisconnect: () => void }) {
  const logs = [
    ['10:32:45', 'Workflow completed successfully'],
    ['10:31:12', 'Download node completed'],
    ['10:30:25', 'Extend Video node completed'],
    ['10:29:54', 'Image to Video node completed'],
  ];
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="fg-kicker">Connected control center</div>
        <span className="fg-badge success"><span className="fg-status-dot online" /> Connected</span>
      </div>

      <div className="connection-grid">
        <section className="connection-card connected fg-card">
          <div className="top"><CircleUserRound size={18} color="#62e49e" /><ChevronRight size={14} className="fg-muted" /></div>
          <div className="title">Google Account</div><div className="value">creator@gmail.com</div>
        </section>
        <section className="connection-card connected fg-card">
          <div className="top"><Network size={18} color="#62e49e" /><ChevronRight size={14} className="fg-muted" /></div>
          <div className="title">Google Flow</div><div className="value">Connected</div>
        </section>
        <section className="connection-card fg-card">
          <div className="top"><FolderOpen size={18} color="#68aaff" /><span className="fg-version">v1.2</span></div>
          <div className="title">Current Project</div><div className="value">Cinematic Car Video</div>
        </section>
        <section className="connection-card fg-card">
          <div className="top"><Gauge size={18} color="#ffad5d" /><span className="fg-badge ready">Live</span></div>
          <div className="title">Available Credits</div><div className="value">1,250</div>
        </section>
      </div>

      <section className="dashboard-section fg-card">
        <div className="section-head"><h3>Last Run Summary</h3><ChevronRight size={14} className="fg-muted" /></div>
        <div className="last-run">
          <div className="preview-thumb" />
          <div><div className="run-title">Cinematic Car Video</div><div className="run-meta">Completed today · 01:24<br />6 / 6 nodes successful</div></div>
          <span className="fg-badge success">Done</span>
        </div>
      </section>

      <section className="dashboard-section fg-card">
        <div className="section-head"><h3>Quick Actions</h3></div>
        <div className="quick-actions">
          <button className="fg-btn quick-action primary" onClick={onOpenStudio}><Workflow size={18} /><span>Open Studio</span></button>
          <button className="fg-btn quick-action"><Play size={18} color="#62aaff" /><span>Run Last</span></button>
          <button className="fg-btn quick-action"><Sparkles size={18} color="#5be0ab" /><span>New Workflow</span></button>
          <button className="fg-btn quick-action"><History size={18} /><span>Run History</span></button>
          <button className="fg-btn quick-action"><Image size={18} /><span>Outputs</span></button>
          <button className="fg-btn quick-action"><CloudDownload size={18} /><span>Downloads</span></button>
        </div>
      </section>

      <section className="dashboard-section fg-card">
        <div className="section-head"><h3>Workflow Preview</h3><span className="fg-muted" style={{ fontSize: 9 }}>6 nodes</span></div>
        <div className="workflow-mini-preview">
          <div className="purple">Prompt</div><div className="purple">Gemini</div><div className="blue">Text to Image</div>
          <div className="green">Image to Video</div><div>Extend</div><div className="blue">Download</div>
        </div>
      </section>

      <section className="dashboard-section fg-card">
        <div className="section-head"><h3>Recent Execution Log</h3><span className="fg-muted" style={{ fontSize: 9 }}>View all</span></div>
        <div className="log-list">
          {logs.map(([time, message]) => <div className="log-row" key={time}><span className="fg-status-dot online" /><span>{time}</span><strong>{message}</strong></div>)}
        </div>
      </section>

      <button className="fg-btn fg-btn-danger" onClick={onDisconnect}><LogOut size={14} /> Disconnect Flow</button>
    </>
  );
}

function App() {
  const [stage, setStage] = useState<ConnectionStage>('signed-out');

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
  }, []);

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
      {stage === 'flow-disconnected' && <FlowDisconnected onConnect={() => changeStage('connected')} onOpenStudio={openStudio} />}
      {stage === 'connected' && <Connected onOpenStudio={openStudio} onDisconnect={() => changeStage('flow-disconnected')} />}
      <footer className="sidepanel-footer"><span>FlowGraph v0.1</span><span>UI Prototype · MV3</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

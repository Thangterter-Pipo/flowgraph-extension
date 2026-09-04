// Project Gate live verification (FG-0205 / FG-1504-FG-1505 / FG-1604)
// Steps:
//   1. Read Flow tab URL + Studio gate state (baseline unlocked).
//   2. Navigate Flow tab to the Flow home (no project open).
//   3. Wait for Studio refresh cycle, probe gate -> expect locked.
//   4. Navigate Flow tab back to the live project.
//   5. Wait, probe gate -> expect unlocked.
// Evidence is written to E:\Flow_veo\flowgraph-extension\evidence\flowgraph_v1\projects\

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9224';
const PROJECT_URL = 'https://labs.google/fx/vi/tools/flow/project/23e7d6d8-d0bc-441b-b720-e63b0ffa9d32';
const HOME_URL = 'https://labs.google/fx/vi/tools/flow';
const STUDIO_PAGE = 'chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html';
const EVIDENCE_DIR = 'E:/Flow_veo/flowgraph-extension/evidence/flowgraph_v1/projects';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return ws;
}

async function cdpEvaluate(ws, expression) {
  const id = Math.floor(Math.random() * 1e9);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 20000);
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) { clearTimeout(timeout); resolve(msg.result?.result?.value ?? msg.result ?? msg); }
    });
  });
}

async function listPages() {
  const pages = await fetch(`${CDP}/json/list`).then((r) => r.json());
  return pages;
}

async function findTab(pageType) {
  const pages = await listPages();
  return pages.find((x) => x.type === 'page' && (x.url || '').includes(pageType));
}

async function navigate(ws, url) {
  ws.send(JSON.stringify({ id: Math.floor(Math.random() * 1e9), method: 'Page.navigate', params: { url } }));
  await new Promise((resolve) => setTimeout(resolve, 6000));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Probe Flow tab: URL, title, projectId from path
async function probeFlow(tab) {
  const ws = await connect(tab.webSocketDebuggerUrl);
  const value = await cdpEvaluate(ws, `(() => ({ url: location.href, title: document.title }))()`);
  ws.close();
  return value;
}

// Probe Studio: gate lock state, Run button disabled, activeProject persisted, pills
async function probeStudio(studio) {
  const ws = await connect(studio.webSocketDebuggerUrl);
  const expr = `(async()=>{
    const q=(type,payload)=>new Promise((resolve)=>{
      const id=Math.random().toString(36).slice(2);
      const msg=payload?{type,requestId:id,payload}:{type,requestId:id};
      chrome.runtime.sendMessage(msg,(resp)=>{
        if(chrome.runtime.lastError) resolve({error:chrome.runtime.lastError.message});
        else resolve(resp);
      });
    });
    const account=await q('FLOWGRAPH_ACCOUNT_STATUS');
    const flow=await q('FLOWGRAPH_FLOW_STATUS');
    const runBtn = Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').trim()==='Run Workflow');
    const gate = document.querySelector('.canvas-gate-overlay');
    const locked = !!gate;
    return {
      url: location.href,
      title: document.title,
      locked,
      gateText: locked ? (gate.innerText||'').slice(0,200) : null,
      runDisabled: runBtn ? runBtn.disabled : null,
      account: account?.data,
      flow: flow?.data,
      activeProject: JSON.parse(localStorage.getItem('flowgraph.activeProject')||'null')
    };
  })()`;
  const value = await cdpEvaluate(ws, expr);
  ws.close();
  return value;
}

mkdirSync(EVIDENCE_DIR, { recursive: true });

const out = { stamp: new Date().toISOString(), steps: [] };

// Step 0: baseline
const studio = await findTab(STUDIO_PAGE);
const flowTab = await findTab('labs.google/fx');
if (!studio || !flowTab) { console.error('TABS_NOT_FOUND', { studio: !!studio, flowTab: !!flowTab }); process.exit(2); }

const baselineFlow = await probeFlow(flowTab);
const baselineStudio = await probeStudio(studio);
out.steps.push({ step: 'baseline', flow: baselineFlow, studio: baselineStudio });
console.log('BASELINE_STUDIO', JSON.stringify(baselineStudio, null, 2));

// Step 1: navigate Flow tab to home (no project)
const flowWs = await connect(flowTab.webSocketDebuggerUrl);
await navigate(flowWs, HOME_URL);
console.log('NAVIGATED_HOME');
await sleep(12000); // allow Studio refresh cycle

// Re-find tabs (navigation may have changed target)
const studioAfterNav = await findTab(STUDIO_PAGE);
const flowAfterNav = await findTab('labs.google/fx');
const homeFlow = await probeFlow(flowAfterNav);
const lockedStudio = await probeStudio(studioAfterNav);
out.steps.push({ step: 'navigate-home', flow: homeFlow, studio: lockedStudio });
console.log('AFTER_HOME_STUDIO', JSON.stringify(lockedStudio, null, 2));

// Step 2: navigate Flow tab back to the project
await navigate(flowWs, PROJECT_URL);
console.log('NAVIGATED_PROJECT');
await sleep(12000);

const studioAfterReturn = await findTab(STUDIO_PAGE);
const flowAfterReturn = await findTab('labs.google/fx');
const projectFlow = await probeFlow(flowAfterReturn);
const unlockedStudio = await probeStudio(studioAfterReturn);
out.steps.push({ step: 'navigate-project', flow: projectFlow, studio: unlockedStudio });
console.log('AFTER_PROJECT_STUDIO', JSON.stringify(unlockedStudio, null, 2));

flowWs.close();

// Write evidence
const file = path.join(EVIDENCE_DIR, `project_gate_live_${STAMP}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('EVIDENCE_WRITTEN', file);

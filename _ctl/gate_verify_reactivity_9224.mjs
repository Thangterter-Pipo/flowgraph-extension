// Project Gate live reactivity verification.
// Verifies the service-worker -> Studio live push: when the Flow tab navigates
// (project -> home, home -> project), the Studio gate must lock/unlock quickly
// WITHOUT a reload and WITHOUT the Studio's 120s poll.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9224';
const PROJECT_URL = 'https://labs.google/fx/vi/tools/flow/project/23e7d6d8-d0bc-441b-b720-e63b0ffa9d32';
const HOME_URL = 'https://labs.google/fx/vi/tools/flow';
const STUDIO_PAGE = 'chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html';
const EVIDENCE_DIR = 'E:/Flow_veo/flowgraph-extension/evidence/flowgraph_v1/projects';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  return ws;
}

async function cdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9);
  ws.send(JSON.stringify({ id, method, params }));
  return await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 20000);
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { clearTimeout(t); resolve(m.result ?? m); } });
  });
}

async function cdpEval(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
}

async function listPages() { return await fetch(`${CDP}/json/list`).then((r) => r.json()); }
async function findTab(needle) { const p = await listPages(); return p.find((x) => x.type === 'page' && (x.url || '').includes(needle)); }

async function navigateFlow(url) {
  const tab = await findTab('labs.google/fx');
  if (!tab) throw new Error('FLOW_TAB_NOT_FOUND');
  const ws = await connect(tab.webSocketDebuggerUrl);
  await cdp(ws, 'Page.navigate', { url });
  ws.close();
}

async function probeStudio() {
  const studio = await findTab(STUDIO_PAGE);
  if (!studio) throw new Error('STUDIO_NOT_FOUND');
  const ws = await connect(studio.webSocketDebuggerUrl);
  const expr = `(async()=>{
    const q=(type,payload)=>new Promise((resolve)=>{
      const id=Math.random().toString(36).slice(2);
      const msg=payload?{type,requestId:id,payload}:{type,requestId:id};
      chrome.runtime.sendMessage(msg,(resp)=>{ if(chrome.runtime.lastError) resolve({error:chrome.runtime.lastError.message}); else resolve(resp); });
    });
    const account=await q('FLOWGRAPH_ACCOUNT_STATUS');
    const flow=await q('FLOWGRAPH_FLOW_STATUS');
    const runBtn = Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').trim()==='Run Workflow');
    const gate = document.querySelector('.canvas-gate-overlay');
    return {
      url: location.href,
      title: document.title,
      locked: !!gate,
      gateText: gate ? (gate.innerText||'').slice(0,200) : null,
      runDisabled: runBtn ? runBtn.disabled : null,
      account: account?.data,
      flow: flow?.data,
      activeProject: JSON.parse(localStorage.getItem('flowgraph.activeProject')||'null')
    };
  })()`;
  const value = await cdpEval(ws, expr);
  ws.close();
  return value;
}

async function probeFlow() {
  const tab = await findTab('labs.google/fx');
  if (!tab) throw new Error('FLOW_TAB_NOT_FOUND');
  const ws = await connect(tab.webSocketDebuggerUrl);
  const value = await cdpEval(ws, `(() => ({ url: location.href, title: document.title }))()`);
  ws.close();
  return value;
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const out = { stamp: new Date().toISOString(), steps: [] };

// Sanity: baseline should be unlocked (Flow tab is on the project).
const baselineFlow = await probeFlow();
const baselineStudio = await probeStudio();
out.steps.push({ step: 'baseline-unlocked', flow: baselineFlow, studio: baselineStudio });
console.log('BASELINE_UNLOCKED', JSON.stringify(baselineStudio, null, 2));

// Navigate Flow to home; wait a SHORT time (reactivity should push lock immediately).
await navigateFlow(HOME_URL);
await sleep(4000);
const homeFlow = await probeFlow();
const homeStudio = await probeStudio();
out.steps.push({ step: 'navigate-home', flow: homeFlow, studio: homeStudio });
console.log('AFTER_HOME_LOCKED', JSON.stringify(homeStudio, null, 2));

// Navigate Flow back to the project; wait a SHORT time (reactivity should push unlock).
await navigateFlow(PROJECT_URL);
await sleep(4000);
const projectFlow = await probeFlow();
const projectStudio = await probeStudio();
out.steps.push({ step: 'navigate-project', flow: projectFlow, studio: projectStudio });
console.log('AFTER_PROJECT_UNLOCKED', JSON.stringify(projectStudio, null, 2));

const file = path.join(EVIDENCE_DIR, `project_gate_live_reactivity_${STAMP}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('EVIDENCE_WRITTEN', file);

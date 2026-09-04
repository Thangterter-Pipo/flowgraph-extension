// Project Gate live verification v2 — forces a Studio reload at each stage so the
// mount-time refreshAccount()/refreshFlow() run and React state catches up to the
// real Flow tab. This proves the actual canvas lock/unlock, not the 120s stale window.

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

async function listPages() { return await fetch(`${CDP}/json/list`).then((r) => r.json()); }
async function findTab(needle) { const p = await listPages(); return p.find((x) => x.type === 'page' && (x.url || '').includes(needle)); }

async function probe(ws) {
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
    return { url: location.href, locked: !!gate, gateText: gate? (gate.innerText||'').slice(0,200):null, runDisabled: runBtn?runBtn.disabled:null, account:account?.data, flow:flow?.data, activeProject:JSON.parse(localStorage.getItem('flowgraph.activeProject')||'null') };
  })()`;
  return await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
}

async function reloadTab(url) {
  const tab = await findTab(url);
  if (!tab) throw new Error('TAB_NOT_FOUND ' + url);
  const ws = await connect(tab.webSocketDebuggerUrl);
  await cdp(ws, 'Page.reload', { ignoreCache: true });
  await sleep(6000);
  ws.close();
}

async function navigateFlow(url) {
  const tab = await findTab('labs.google/fx');
  if (!tab) throw new Error('FLOW_TAB_NOT_FOUND');
  const ws = await connect(tab.webSocketDebuggerUrl);
  await cdp(ws, 'Page.navigate', { url });
  await sleep(7000);
  ws.close();
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const out = { stamp: new Date().toISOString(), steps: [] };

// Baseline: navigate to project, reload Studio, probe -> unlocked
await navigateFlow(PROJECT_URL);
await reloadTab(STUDIO_PAGE);
await reloadTab(STUDIO_PAGE); // second reload to be sure mount ran clean
let studioTab = await findTab(STUDIO_PAGE);
let wsStudio = await connect(studioTab.webSocketDebuggerUrl);
let baseline = await probe(wsStudio);
wsStudio.close();
out.steps.push({ step: 'project-unlocked', value: baseline });
console.log('PROJECT_UNLOCKED', JSON.stringify(baseline, null, 2));

// Lock: navigate Flow to home, reload Studio, probe -> locked
await navigateFlow(HOME_URL);
await reloadTab(STUDIO_PAGE);
await reloadTab(STUDIO_PAGE);
studioTab = await findTab(STUDIO_PAGE);
wsStudio = await connect(studioTab.webSocketDebuggerUrl);
const locked = await probe(wsStudio);
wsStudio.close();
out.steps.push({ step: 'home-locked', value: locked });
console.log('HOME_LOCKED', JSON.stringify(locked, null, 2));

// Unlock: navigate Flow back to project, reload Studio, probe -> unlocked
await navigateFlow(PROJECT_URL);
await reloadTab(STUDIO_PAGE);
await reloadTab(STUDIO_PAGE);
studioTab = await findTab(STUDIO_PAGE);
wsStudio = await connect(studioTab.webSocketDebuggerUrl);
const unlocked = await probe(wsStudio);
wsStudio.close();
out.steps.push({ step: 'project-unlocked-again', value: unlocked });
console.log('PROJECT_UNLOCKED_AGAIN', JSON.stringify(unlocked, null, 2));

const file = path.join(EVIDENCE_DIR, `project_gate_live_reload_${STAMP}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('EVIDENCE_WRITTEN', file);

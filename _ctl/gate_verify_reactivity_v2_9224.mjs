// Project Gate live reactivity v2 — reads the React-driven gate (not the SW msg
// round-trip) at multiple time points, so we prove the push locks/unlocks the
// canvas WITHOUT a reload or a 120s poll.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9224';
const PROJECT_URL = 'https://labs.google/fx/vi/tools/flow/project/23e7d6d8-d0bc-441b-b720-e63b0ffa9d32';
const HOME_URL = 'https://labs.google/fx/vi/tools/flow';
const STUDIO_PAGE = 'chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html';
const EVIDENCE_DIR = 'E:/Flow_veo/flowgraph-extension/evidence/flowgraph_v1/projects';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SAMPLE = 5000;

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

async function probeReactGate() {
  const studio = await findTab(STUDIO_PAGE);
  if (!studio) throw new Error('STUDIO_NOT_FOUND');
  const ws = await connect(studio.webSocketDebuggerUrl);
  const expr = `(() => {
    const gate = document.querySelector('.canvas-gate-overlay');
    const gateCard = document.querySelector('.canvas-gate-card');
    const pills = document.querySelectorAll('.connection-pill');
    const runBtn = Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').trim()==='Run Workflow');
    return {
      ts: Date.now(),
      url: location.href,
      gatePresent: !!gate,
      gateText: gateCard ? (gateCard.innerText||'').slice(0,120) : null,
      pills: Array.from(pills).map(p => ({ cls: p.className, text: (p.innerText||'').trim().slice(0,60) })),
      runDisabled: runBtn ? runBtn.disabled : null,
      activeProject: JSON.parse(localStorage.getItem('flowgraph.activeProject')||'null')
    };
  })()`;
  const r = await cdpEval(ws, expr);
  ws.close();
  return r;
}

async function probeFlow() {
  const tab = await findTab('labs.google/fx');
  if (!tab) throw new Error('FLOW_TAB_NOT_FOUND');
  const ws = await connect(tab.webSocketDebuggerUrl);
  const v = await cdpEval(ws, `(() => ({ url: location.href, title: document.title }))()`);
  ws.close();
  return v;
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const out = { stamp: new Date().toISOString(), steps: [] };

// Ensure baseline reactor settled (Flow tab on project -> gate should be unlocked).
await wait(2000);
const baselineFlow = await probeFlow();
const baselineGate = await probeReactGate();
out.steps.push({ step: 'baseline-unlocked', flow: baselineFlow, gate: baselineGate });
console.log('BASELINE', JSON.stringify(baselineGate, null, 2));

// Navigate to home; sample at 1s, 3s, 5s to catch the push (no reload/poll).
await navigateFlow(HOME_URL);
for (const t of [1000, 3000, SAMPLE]) {
  await wait(t === 1000 ? 1000 : t - (t === 3000 ? 1000 : 0));
  const flow = await probeFlow();
  const gate = await probeReactGate();
  out.steps.push({ step: `home-${t}ms`, flow, gate });
  console.log(`HOME_${t}ms`, JSON.stringify({ flow, gate }, null, 2));
}

// Navigate back to project; sample at 1s, 3s, 5s.
await navigateFlow(PROJECT_URL);
for (const t of [1000, 3000, SAMPLE]) {
  await wait(t === 1000 ? 1000 : t - (t === 3000 ? 1000 : 0));
  const flow = await probeFlow();
  const gate = await probeReactGate();
  out.steps.push({ step: `project-${t}ms`, flow, gate });
  console.log(`PROJECT_${t}ms`, JSON.stringify({ flow, gate }, null, 2));
}

const file = path.join(EVIDENCE_DIR, `project_gate_live_reactivity_${STAMP}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('EVIDENCE_WRITTEN', file);

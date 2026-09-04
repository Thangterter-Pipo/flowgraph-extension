// Read the actual React-driven gate state from the live Studio (no reload).
// Distinguishes overlaid lock from unlocked by reading pill labels + gate card text.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9224';
const STUDIO_PAGE = 'chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html';
const EVIDENCE_DIR = 'E:/Flow_veo/flowgraph-extension/evidence/flowgraph_v1/projects';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

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

const studio = await findTab(STUDIO_PAGE);
if (!studio) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = await connect(studio.webSocketDebuggerUrl);
const expr = `(() => {
  const gate = document.querySelector('.canvas-gate-overlay');
  const gateCard = document.querySelector('.canvas-gate-card');
  const pills = document.querySelectorAll('.connection-pill');
  const runBtn = Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').trim()==='Run Workflow');
  return {
    url: location.href,
    gatePresent: !!gate,
    gateText: gateCard ? (gateCard.innerText||'').slice(0,300) : null,
    pills: Array.from(pills).map(p => ({ cls: p.className, text: (p.innerText||'').trim().slice(0,80) })),
    runDisabled: runBtn ? runBtn.disabled : null,
    activeProject: JSON.parse(localStorage.getItem('flowgraph.activeProject')||'null')
  };
})()`;
const r = await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true });
ws.close();
const value = r?.result?.value;
console.log('GATE_REACT_STATE', JSON.stringify(value, null, 2));

mkdirSync(EVIDENCE_DIR, { recursive: true });
const file = path.join(EVIDENCE_DIR, `project_gate_react_state_${STAMP}.json`);
writeFileSync(file, JSON.stringify({ stamp: new Date().toISOString(), value }, null, 2));
console.log('EVIDENCE_WRITTEN', file);

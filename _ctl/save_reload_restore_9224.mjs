// Save / Reload / Restore live verification (FG-1101/FG-1102, FG-1504 release gate)
// Steps:
//   1. Probe current Studio canvas: nodes, edges, workflow name, activeProject, run status.
//   2. Click the real "Save" button.
//   3. Read back localStorage 'flowgraph.demo.workflow' (schema v3, projectBinding, runtimeResults).
//   4. Reload the Studio page.
//   5. Probe restored canvas: nodes, edges, workflow name, + rehydrated runtime media results.
//   6. Emit a sanitized result (no preview URLs / no secrets).

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9224';
const STUDIO_PAGE = 'chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html';
const EVIDENCE_DIR = 'E:/Flow_veo/flowgraph-extension/evidence/flowgraph_v1/e2e';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
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

async function probeStudio(ws) {
  const expr = `(async()=>{
    const q=(type,payload)=>new Promise((resolve)=>{
      const id=Math.random().toString(36).slice(2);
      const msg=payload?{type,requestId:id,payload}:{type,requestId:id};
      chrome.runtime.sendMessage(msg,(resp)=>{ if(chrome.runtime.lastError) resolve({error:chrome.runtime.lastError.message}); else resolve(resp); });
    });
    const account=await q('FLOWGRAPH_ACCOUNT_STATUS');
    const flow=await q('FLOWGRAPH_FLOW_STATUS');
    const runBtn = Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').trim()==='Run Workflow');
    // React Flow canvas lives in a custom element tree. Read known text markers + localStorage state.
    const saved = localStorage.getItem('flowgraph.demo.workflow');
    const activeProject = JSON.parse(localStorage.getItem('flowgraph.activeProject')||'null');
    let parsedSaved = null;
    try { parsedSaved = saved ? JSON.parse(saved) : null; } catch(e) { parsedSaved = null; }
    return {
      url: location.href,
      title: document.title,
      hasCanvas: !!document.querySelector('.react-flow'),
      nodeCards: Array.from(document.querySelectorAll('.react-flow__node')).length,
      runDisabled: runBtn ? runBtn.disabled : null,
      locked: !!document.querySelector('.canvas-gate-overlay'),
      activeProject,
      account: account?.data,
      flow: flow?.data,
      savedWorkflow: parsedSaved ? {
        schemaVersion: parsedSaved.schemaVersion,
        name: parsedSaved.name,
        savedAt: parsedSaved.savedAt,
        nodeCount: parsedSaved.nodes?.length,
        edgeCount: parsedSaved.edges?.length,
        projectBinding: parsedSaved.projectBinding ?? null,
        runtimeResults: parsedSaved.runtimeResults ? Object.fromEntries(Object.entries(parsedSaved.runtimeResults).map(([k,v])=>[k,{type:v.type,mediaId:v.mediaId,mimeType:v.mimeType,fileName:v.fileName}])) : null
      } : null
    };
  })()`;
  return await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
}

async function clickSave(ws) {
  const expr = `(()=>{ const b=Array.from(document.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='Save'); if(!b) return {clicked:false}; b.click(); return {clicked:true}; })()`;
  return await cdp(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
}

async function reloadStudio() {
  const tab = await findTab(STUDIO_PAGE);
  if (!tab) throw new Error('STUDIO_NOT_FOUND');
  const ws = await connect(tab.webSocketDebuggerUrl);
  await cdp(ws, 'Page.reload', { ignoreCache: true });
  await sleep(6000);
  ws.close();
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
const out = { stamp: new Date().toISOString(), steps: {} };

// Explore the Flow tab is on project? Ensure it's on project for a valid restore.

const studioTab = await findTab(STUDIO_PAGE);
if (!studioTab) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
let ws = await connect(studioTab.webSocketDebuggerUrl);
const before = await probeStudio(ws);
out.steps.before = before;
console.log('BEFORE', JSON.stringify(before, null, 2));

const clickResult = await clickSave(ws);
out.steps.saveClick = clickResult;
console.log('SAVE_CLICK', JSON.stringify(clickResult, null, 2));
await sleep(1500);

const after = await probeStudio(ws);
out.steps.afterSave = after;
console.log('AFTER_SAVE', JSON.stringify(after, null, 2));
ws.close();

await reloadStudio();

const studioTab2 = await findTab(STUDIO_PAGE);
ws = await connect(studioTab2.webSocketDebuggerUrl);
const restored = await probeStudio(ws);
out.steps.restored = restored;
console.log('RESTORED', JSON.stringify(restored, null, 2));
ws.close();

const file = path.join(EVIDENCE_DIR, `save_reload_restore_${STAMP}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('EVIDENCE_WRITTEN', file);

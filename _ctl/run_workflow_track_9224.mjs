// Robust workflow runner with fresh-run detection: clicks "Run Workflow",
// dismisses the credit-warning modal via "Run anyway", and verifies the run
// produced a NEW mediaId (not a cache replay).
const pages = await fetch('http://127.0.0.1:9224/json/list').then((r) => r.json());
const t = pages.find((x) => x.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(x.url || ''));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map(); const events = [];
ws.addEventListener('message', (ev) => { const x = JSON.parse(ev.data); if (x.method) events.push(x); const r = pending.get(x.id); if (r) { pending.delete(x.id); r(x); } });
function call(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => { pending.set(id, resolve); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 15000); }); }
async function evalv(expression) { const m = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return m.result?.result?.value; }
await call('Runtime.enable');

// Capture the prior t2v media id for fresh-run comparison, if present.
const before = await evalv(`(() => { const raw=localStorage.getItem('flowgraph.runHistory.v1'); if(!raw)return null; const a=JSON.parse(raw); const r=a.find(x=>(x.nodeRuns||[]).some(n=>n.nodeId==='t2v'&&n.result?.mediaId)); return r?r.nodeRuns.find(n=>n.nodeId==='t2v').result.mediaId:null; })()`);
console.log('BEFORE_T2V_MEDIA', JSON.stringify(before));

const clicked = await evalv(`(() => {const b=Array.from(document.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='Run Workflow'); if(!b)return {ok:false,reason:'not-found'}; if(b.disabled)return {ok:false,reason:'disabled'}; b.click(); return {ok:true};})()`);
console.log('CLICK', JSON.stringify(clicked));
if (!clicked.ok) { ws.close(); process.exit(2); }

await new Promise((r) => setTimeout(r, 1200));
const modal = await evalv(`(() => {const m=Array.from(document.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='Run anyway'); if(!m)return {dismissed:false}; m.click(); return {dismissed:true};})()`);
console.log('CONFIRM', JSON.stringify(modal));

const started = Date.now(); let last = '';
while (Date.now() - started < 420000) {
  await new Promise((r) => setTimeout(r, 4000));
  const state = await evalv(`(() => {const p=document.querySelector('.execution-panel'); if(!p)return {missing:true}; const cards=Array.from(p.querySelectorAll('.run-node-card')).map(c=>({title:c.querySelector('.run-node-title')?.innerText?.trim(),status:c.querySelector('.fg-badge')?.innerText?.trim(),meta:c.querySelector('.run-node-meta')?.innerText?.trim()})); const head=p.querySelector('.execution-head .fg-badge')?.innerText?.trim(); const summary=Array.from(p.querySelectorAll('.summary-row')).map(r=>r.innerText.trim()); return {head,cards,summary};})()`);
  const s = JSON.stringify(state); if (s !== last) { console.log(new Date().toISOString(), s); last = s; }
  if (state?.head === 'SUCCESS' || state?.head === 'FAILED') {
    const after = await evalv(`(() => { const raw=localStorage.getItem('flowgraph.runHistory.v1'); if(!raw)return null; const a=JSON.parse(raw); const r=a[0]; return {runId:r?.runId,status:r?.status,media:r?.nodeRuns?.find(n=>n.nodeId==='t2v')?.result?.mediaId}; })()`);
    console.log('AFTER', JSON.stringify(after));
    console.log('FINAL', JSON.stringify(state, null, 2));
    const syncLogs = events
      .filter((event) => event.method === 'Runtime.consoleAPICalled')
      .map((event) => event.params?.args?.map((arg) => arg.value ?? arg.description).join(' ') || '')
      .filter((line) => line.includes('[FlowGraph Sync]'))
      .slice(-40);
    console.log('SYNC_LOGS', JSON.stringify(syncLogs));
    ws.close();
    const fresh = after?.media && after.media !== before;
    process.exit(state.head === 'SUCCESS' && fresh ? 0 : (state.head === 'SUCCESS' ? 5 : 3));
  }
}
console.log('FINAL_TIMEOUT'); ws.close(); process.exit(4);

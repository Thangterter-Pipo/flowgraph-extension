import { readFileSync } from 'node:fs';

const pages = await fetch('http://127.0.0.1:9226/json/list').then(r => r.json());
const flow = pages.find(x => (x.url || '').includes('labs.google/fx') && x.type === 'page');
const studio = pages.find(x => (x.url || '').includes('/studio.html') && x.type === 'page');

if (flow) {
  const ws = new WebSocket(flow.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const reqId = Math.floor(Math.random() * 1e9);
  const expr = `(async()=>{try{const r=await fetch('https://labs.google/fx/api/auth/session',{credentials:'include'});const j=await r.json().catch(()=>null);return {status:r.status,ok:r.ok,hasAccessToken:!!j?.access_token,user:j?.user?{email:j.user.email,name:j.user.name}:null};}catch(e){return {error:String(e)}}})()`;
  ws.send(JSON.stringify({ id: reqId, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  const m = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), 12000); ws.addEventListener('message', ev => { const x = JSON.parse(ev.data); if (x.id === reqId) { clearTimeout(t); resolve(x); } }); });
  ws.close();
  console.log('FLOW_SESSION ' + JSON.stringify(m.result?.result?.value ?? m));
}

if (studio) {
  const ws = new WebSocket(studio.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  const reqId = Math.floor(Math.random() * 1e9);
  const expr = `(() => ({
    url: location.href,
    title: document.title,
    hasCanvas: !!document.querySelector('.react-flow'),
    nodeCards: document.querySelectorAll('.react-flow__node').length,
    locked: !!document.querySelector('.canvas-gate-overlay'),
    gateText: (() => { const el = document.querySelector('.canvas-gate-overlay'); return el ? (el.innerText || '').trim().slice(0,300) : null; })(),
    accountPill: JSON.parse(localStorage.getItem('flowgraph.accountPill') || 'null'),
    flowPill: JSON.parse(localStorage.getItem('flowgraph.flowPill') || 'null'),
    activeProject: JSON.parse(localStorage.getItem('flowgraph.activeProject') || 'null'),
    savedWorkflow: JSON.parse(localStorage.getItem('flowgraph.demo.workflow') || 'null')
  }))()`;
  ws.send(JSON.stringify({ id: reqId, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  const m = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), 12000); ws.addEventListener('message', ev => { const x = JSON.parse(ev.data); if (x.id === reqId) { clearTimeout(t); resolve(x); } }); });
  ws.close();
  console.log('STUDIO ' + JSON.stringify(m.result?.result?.value ?? m));
}

if (!flow && !studio) {
  console.error('NO_TARGETS');
  process.exit(2);
}

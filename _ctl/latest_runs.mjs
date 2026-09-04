const pages = await fetch('http://127.0.0.1:9224/json/list').then((r) => r.json());
const t = pages.find((x) => (x.url || '').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
const expr = `(() => {
  const raw = localStorage.getItem('flowgraph.runHistory.v1');
  if (!raw) return null;
  const a = JSON.parse(raw);
  return a.slice(0, 2).map((r) => ({
    runId: r.runId,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    projectId: r.projectId,
    nodeRuns: r.nodeRuns,
  }));
})()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
const msg = await new Promise((resolve, reject) => {
  const tt = setTimeout(() => reject(new Error('timeout')), 15000);
  ws.addEventListener('message', (ev) => { const x = JSON.parse(ev.data); if (x.id === 1) { clearTimeout(tt); resolve(x); } });
});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg, null, 2));

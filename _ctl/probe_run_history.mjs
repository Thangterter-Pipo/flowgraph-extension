const pages = await fetch('http://127.0.0.1:9224/json/list').then((r) => r.json());
const t = pages.find((x) => (x.url || '').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
const expression = `(() => {
  const raw = localStorage.getItem('flowgraph.runHistory.v1');
  if (!raw) return { present: false };
  try {
    const items = JSON.parse(raw);
    return { present: true, count: items.length, items: items.map((r) => ({ runId: r.runId, status: r.status, projectId: r.projectId, runAt: r.runAt, nodeResults: r.nodeResults, runtimeResults: r.runtimeResults })) };
  } catch (e) { return { present: true, error: String(e) }; }
})()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
const msg = await new Promise((resolve, reject) => {
  const tt = setTimeout(() => reject(new Error('timeout')), 15000);
  ws.addEventListener('message', (ev) => { const x = JSON.parse(ev.data); if (x.id === 1) { clearTimeout(tt); resolve(x); } });
});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg, null, 2));

const pages = await fetch('http://127.0.0.1:9224/json/list').then((r) => r.json());
const t = pages.find((x) => (x.url || '').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
const expression = `(() => {
  const raw = localStorage.getItem('flowgraph.demo.workflow');
  if (!raw) return { present: false };
  try {
    const w = JSON.parse(raw);
    return {
      present: true,
      schemaVersion: w.schemaVersion,
      hasRuntimeResults: !!w.runtimeResults,
      runtimeResultKeys: w.runtimeResults ? Object.keys(w.runtimeResults) : [],
      runtimeResults: w.runtimeResults ? Object.fromEntries(Object.entries(w.runtimeResults).map(([k, v]) => [k, { type: v.type, mediaId: v.mediaId, previewUrl: v.previewUrl, mimeType: v.mimeType, fileName: v.fileName }])) : null,
      nodes: (w.nodes || []).map((n) => ({ id: n.id, kind: n.data?.kind, status: n.data?.status, result: n.data?.result ? { type: n.data.result.type, previewUrl: n.data.result.previewUrl, mediaId: n.data.result.mediaId } : undefined }))
    };
  } catch (e) { return { present: true, error: String(e) }; }
})()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
const msg = await new Promise((resolve, reject) => {
  const tt = setTimeout(() => reject(new Error('timeout')), 15000);
  ws.addEventListener('message', (ev) => { const x = JSON.parse(ev.data); if (x.id === 1) { clearTimeout(tt); resolve(x); } });
});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg, null, 2));

// Second pass: dump all localStorage keys (truncated) for diagnostics.
const ex2 = `(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, (localStorage.getItem(k) || '').slice(0, 160)])))()`;
const ws2 = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws2.addEventListener('open', res, { once: true }); ws2.addEventListener('error', rej, { once: true }); });
ws2.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: ex2, returnByValue: true, awaitPromise: true } }));
const msg2 = await new Promise((resolve, reject) => {
  const tt = setTimeout(() => reject(new Error('timeout')), 15000);
  ws2.addEventListener('message', (ev) => { const x = JSON.parse(ev.data); if (x.id === 2) { clearTimeout(tt); resolve(x); } });
});
ws2.close();
console.log('ALL_KEYS:\n' + JSON.stringify(msg2.result?.result?.value ?? msg2, null, 2));

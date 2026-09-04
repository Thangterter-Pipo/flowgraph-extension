const pages = await fetch('http://127.0.0.1:9226/json/list').then(r => r.json());
const flow = pages.find(x => (x.url || '').includes('labs.google/fx') && x.type === 'page');
if (!flow) { console.error('FLOW_PAGE_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(flow.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
const reqId = Math.floor(Math.random() * 1e9);
const expr = `(() => {
  const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src).filter(x => x.includes('chrome-extension'));
  const bodySnippet = (document.body?.innerText || '').slice(0, 200);
  return { url: location.href, hasContentScript: !!scripts.length, extScripts: scripts, bodySnippet };
})()`;
ws.send(JSON.stringify({ id: reqId, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
const m = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), 12000); ws.addEventListener('message', ev => { const x = JSON.parse(ev.data); if (x.id === reqId) { clearTimeout(t); resolve(x); } }); });
ws.close();
console.log(JSON.stringify(m.result?.result?.value ?? m, null, 2));

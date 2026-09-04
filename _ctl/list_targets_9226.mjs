const version = await fetch('http://127.0.0.1:9226/json/version').then(r => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
const reqId = Math.floor(Math.random() * 1e9);
ws.send(JSON.stringify({ id: reqId, method: 'Target.getTargets' }));
const m = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), 12000); ws.addEventListener('message', ev => { const x = JSON.parse(ev.data); if (x.id === reqId) { clearTimeout(t); resolve(x); } }); });
ws.close();
const targets = m?.result?.targetInfos || [];
const ext = targets.filter(x => (x.url || '').startsWith('chrome-extension://'));
console.log(JSON.stringify(ext, null, 2));
if (!ext.length) {
  console.error('NO_EXTENSION_TARGETS');
  process.exit(2);
}

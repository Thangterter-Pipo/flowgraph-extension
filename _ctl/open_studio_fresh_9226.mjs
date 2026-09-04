const pages = await fetch('http://127.0.0.1:9226/json/list').then(r => r.json());
const sw = pages.find(x => (x.url || '').startsWith('chrome-extension://') && (x.url || '').includes('service_worker.js'));
const extId = sw ? new URL(sw.url).host : null;
if (!extId) { console.error('EXT_ID_NOT_FOUND'); process.exit(2); }

const flow = pages.find(x => (x.url || '').includes('labs.google/fx') && x.type === 'page');
const target = flow || pages.find(x => x.type === 'page');
if (!target) { console.error('NO_PAGE_TARGET'); process.exit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
const reqId = Math.floor(Math.random() * 1e9);
const studioUrl = `chrome-extension://${extId}/studio.html`;
ws.send(JSON.stringify({ id: reqId, method: 'Page.navigate', params: { url: studioUrl } }));
const m = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), 12000); ws.addEventListener('message', ev => { const x = JSON.parse(ev.data); if (x.id === reqId) { clearTimeout(t); resolve(x); } }); });
ws.close();
console.log('NAV ' + studioUrl);
console.log(JSON.stringify(m));

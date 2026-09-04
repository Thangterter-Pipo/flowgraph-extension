// Uses Node's built-in WebSocket (Node 22+ / v24 has global WebSocket)
const list = await fetch('http://127.0.0.1:9224/json/list').then(r => r.json());
const studio = list.find(t => t.type === 'page' && t.url.includes('studio.html'));
if (!studio) {
  console.log('NO_STUDIO_TARGET');
  process.exit(1);
}

const ws = new WebSocket(studio.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

const expr = `(async () => {
  const out = {};
  try {
    const status = await chrome.runtime.sendMessage({ type: 'PING_HEALTH' });
    out.ping = status;
  } catch (e) {
    out.pingErr = String(e && e.message || e);
  }
  try {
    const ext = chrome.runtime.getManifest();
    out.manifestName = ext.name;
    out.manifestVersion = ext.version;
  } catch (e) {
    out.manifestErr = String(e && e.message || e);
  }
  try {
    out.lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
  } catch (e) {
    out.lastError = String(e && e.message || e);
  }
  return out;
})()`;

const evalResult = await call('Runtime.evaluate', {
  expression: expr,
  awaitPromise: true,
  returnByValue: true
});

console.log(JSON.stringify(evalResult.result.value, null, 2));
ws.close();
process.exit(0);

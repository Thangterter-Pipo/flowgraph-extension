const list = await fetch('http://127.0.0.1:9224/json/list').then(r => r.json());
const worker = list.find(t => t.type === 'worker');
if (!worker) {
  console.log('NO_WORKER_TARGET');
  process.exit(1);
}
console.log('WORKER_TARGET', JSON.stringify(worker, null, 2));

const ws = new WebSocket(worker.webSocketDebuggerUrl);
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

// Evaluate in worker context
try {
  const evalResult = await call('Runtime.evaluate', {
    expression: `(async () => {
      const out = {};
      out.workerGlobal = typeof self !== 'undefined' ? 'yes' : 'no';
      out.hasChrome = typeof chrome !== 'undefined';
      out.serviceWorker = typeof ServiceWorkerGlobalScope !== 'undefined';
      try {
        const manifest = chrome.runtime.getManifest();
        out.manifestName = manifest.name;
        out.manifestVersion = manifest.version;
      } catch (e) {
        out.manifestErr = String(e && e.message || e);
      }
      try {
        const info = await chrome.storage.local.get(null);
        out.storageKeys = Object.keys(info || {});
      } catch (e) {
        out.storageErr = String(e && e.message || e);
      }
      return out;
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('EVAL', JSON.stringify(evalResult, null, 2));
} catch (e) {
  console.log('EVAL_ERR', e.message);
}

ws.close();
process.exit(0);

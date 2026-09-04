// Restart only the unpacked extension service worker so an open Studio page
// (and its in-memory runtime cache) remains intact. Verifies the restarted
// worker loaded the current bundled readiness code.
const endpoint = 'http://127.0.0.1:9224';
const workerPattern = /chrome-extension:\/\/[^/]+\/background\/service-worker\.js$/;

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method) events.push(message);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const call = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, 15_000);
    });
  };
  return { socket, call, events };
}

async function wakeFromStudio(studioTarget) {
  const studioCdp = await connect(studioTarget.webSocketDebuggerUrl);
  await studioCdp.call('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      const requestId = 'worker-wake-' + crypto.randomUUID();
      chrome.runtime.sendMessage({ type: 'FLOWGRAPH_FLOW_STATUS', requestId }, (reply) => {
        resolve(chrome.runtime.lastError ? { ok: false } : { ok: Boolean(reply?.ok) });
      });
    })`,
    awaitPromise: true,
    returnByValue: true,
  });
  studioCdp.socket.close();
}

let beforeTargets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const studio = beforeTargets.find((target) => target.type === 'page'
  && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
if (!studio) throw new Error('STUDIO_NOT_FOUND');
let oldWorker = beforeTargets.find((target) => target.type === 'service_worker' && workerPattern.test(target.url || ''));
if (!oldWorker) {
  await wakeFromStudio(studio);
  await new Promise((resolve) => setTimeout(resolve, 300));
  beforeTargets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
  oldWorker = beforeTargets.find((target) => target.type === 'service_worker' && workerPattern.test(target.url || ''));
}
if (!oldWorker) throw new Error('EXTENSION_WORKER_NOT_FOUND');

const version = await fetch(`${endpoint}/json/version`).then((response) => response.json());
const browser = await connect(version.webSocketDebuggerUrl);
await browser.call('Target.closeTarget', { targetId: oldWorker.id });
browser.socket.close();
await new Promise((resolve) => setTimeout(resolve, 500));

// A harmless status request wakes the worker from the current extension bundle.
await wakeFromStudio(studio);
await new Promise((resolve) => setTimeout(resolve, 500));

const afterTargets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const newWorker = afterTargets.find((target) => target.type === 'service_worker' && workerPattern.test(target.url || ''));
const studioStillOpen = afterTargets.some((target) => target.id === studio.id);
if (!newWorker) throw new Error('RESTARTED_EXTENSION_WORKER_NOT_FOUND');

const workerCdp = await connect(newWorker.webSocketDebuggerUrl);
await workerCdp.call('Debugger.enable');
await workerCdp.call('Runtime.enable');
await new Promise((resolve) => setTimeout(resolve, 150));
const parsed = workerCdp.events
  .filter((event) => event.method === 'Debugger.scriptParsed')
  .map((event) => event.params)
  .find((params) => workerPattern.test(params.url || ''));
let currentReadinessCode = false;
if (parsed?.scriptId) {
  const source = await workerCdp.call('Debugger.getScriptSource', { scriptId: parsed.scriptId });
  currentReadinessCode = String(source?.scriptSource || '')
    .includes('Flow frame controls did not become ready after mode switch.');
}
workerCdp.socket.close();

const result = {
  ok: oldWorker.id !== newWorker.id && studioStillOpen && currentReadinessCode,
  oldWorkerId: oldWorker.id,
  newWorkerId: newWorker.id,
  studioStillOpen,
  currentReadinessCode,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

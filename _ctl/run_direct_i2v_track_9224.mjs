// Exercise the production FLOWGRAPH_GENERATE I2V path with an exact upstream
// image already present in the active project. No auth material is read/logged.
const [projectId, imageMediaId] = process.argv.slice(2);
if (!projectId || !imageMediaId) {
  console.error('USAGE: node run_direct_i2v_track_9224.mjs <projectId> <imageMediaId>');
  process.exit(2);
}

const pages = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const studioTarget = pages.find((target) => target.type === 'page'
  && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
const exactFlow = pages.find((target) => target.type === 'page'
  && (target.url || '').includes(`/tools/flow/project/${projectId}`));
if (!studioTarget || !exactFlow) throw new Error('STUDIO_OR_EXACT_FLOW_PROJECT_NOT_FOUND');

const socket = new WebSocket(studioTarget.webSocketDebuggerUrl);
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
  clearTimeout(entry.timer);
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
  else entry.resolve(message);
});
function call(method, params = {}, timeoutMs = 15_000) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}
async function evaluate(expression, timeoutMs) {
  const response = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, timeoutMs);
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      || response.result.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.result?.value;
}

await call('Runtime.enable');
const sourceCheck = await evaluate(`((mediaId) => {
  const candidates = [...document.querySelectorAll('.react-flow__node')];
  document.querySelector('.react-flow__node[data-id="3"]')?.click();
  return { selectedI2v: candidates.some((node) => node.getAttribute('data-id') === '3'), mediaId };
})(${JSON.stringify(imageMediaId)})`);
if (!sourceCheck?.selectedI2v) throw new Error('I2V_NODE_NOT_FOUND');
// Match Studio's Run behavior: active-node writes are serialized and must be
// complete before generation preflight opens any Flow menus of its own.
await new Promise((resolve) => setTimeout(resolve, 4_000));
const syncDeadline = Date.now() + 12_000;
let syncState;
while (Date.now() < syncDeadline) {
  syncState = await evaluate(`(() => {
    const pill = [...document.querySelectorAll('.connection-pill')]
      .find((candidate) => ['SYNCED', 'SYNCING', 'DESYNCED']
        .includes((candidate.textContent || '').trim()));
    return { status: (pill?.textContent || '').trim(), title: pill?.getAttribute('title') };
  })()`);
  if (syncState?.status === 'SYNCED') break;
  if (syncState?.status === 'DESYNCED') {
    throw new Error(`ACTIVE_NODE_DESYNCED: ${syncState.title || 'unknown sync failure'}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}
if (syncState?.status !== 'SYNCED') throw new Error('ACTIVE_NODE_SYNC_TIMEOUT');
await new Promise((resolve) => setTimeout(resolve, 500));

const actionEpochMs = Date.now();
const actionTimestamp = new Date().toISOString();
const expression = `new Promise((resolve) => {
  const requestId = 'live-direct-i2v-' + crypto.randomUUID();
  chrome.runtime.sendMessage({
    type: 'FLOWGRAPH_GENERATE',
    requestId,
    payload: {
      kind: 'i2v',
      projectId: ${JSON.stringify(projectId)},
      prompt: 'A futuristic sports car driving smoothly through neon rain at night, cinematic camera motion.',
      modelKey: 'Omni Flash',
      modelLabel: 'Omni 1.1 Flash',
      aspectRatio: '16:9 (Landscape)',
      durationSeconds: 4,
      targetResolution: '360p',
      startImage: { mediaId: ${JSON.stringify(imageMediaId)} },
    },
  }, (reply) => {
    resolve(chrome.runtime.lastError
      ? { ok: false, error: { code: 'BRIDGE_UNAVAILABLE', message: chrome.runtime.lastError.message } }
      : reply);
  });
})`;
const responsePromise = evaluate(expression, 420_000);
let settled = false;
responsePromise.finally(() => { settled = true; });
while (!settled) {
  await Promise.race([
    responsePromise.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (!settled) console.log('WAIT', new Date().toISOString());
}
const response = await responsePromise;
await new Promise((resolve) => setTimeout(resolve, 800));
const studioState = await evaluate(`(() => {
  const node = document.querySelector('.react-flow__node[data-id="3"]');
  return {
    nodeText: (node?.innerText || '').trim(),
    sync: [...document.querySelectorAll('.connection-pill')]
      .map((pill) => (pill.textContent || '').trim())
      .find((text) => ['SYNCED', 'SYNCING', 'DESYNCED'].includes(text)) || null,
  };
})()`);
const syncLogs = events
  .filter((event) => event.method === 'Runtime.consoleAPICalled'
    && Number(event.params?.timestamp || 0) >= actionEpochMs)
  .map((event) => event.params?.args?.map((arg) => arg.value ?? arg.description).join(' ') || '')
  .filter((line) => line.includes('[FlowGraph Sync]'))
  .slice(-80);
socket.close();

const media = response?.data;
const result = {
  ok: response?.ok === true
    && media?.type === 'VIDEO'
    && typeof media?.mediaId === 'string'
    && media.mediaId !== imageMediaId,
  direction: 'FLOWGRAPH_TO_GOOGLE_FLOW',
  operation: 'I2V_GENERATE',
  actionTimestamp,
  projectId,
  upstreamImageMediaId: imageMediaId,
  videoMediaId: media?.mediaId ?? null,
  responseCode: response?.error?.code ?? null,
  responseMessage: response?.error?.message ?? null,
  studioState,
  syncLogs,
};
console.log('RESULT', JSON.stringify(result));
if (!result.ok) process.exit(4);

// Live full-chain runner for the test profile. Discovers the extension id at
// runtime, confirms the credit warning if shown, and requires fresh T2I + I2V
// media ids before reporting success.
const pages = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = pages.find((page) => page.type === 'page'
  && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(page.url || ''));
if (!target) {
  console.error('STUDIO_NOT_FOUND');
  process.exit(2);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
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
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

function call(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, 15_000);
  });
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      || response.result.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.result?.value;
}

await call('Runtime.enable');
const before = await evaluate(`(() => {
  const history = JSON.parse(localStorage.getItem('flowgraph.runHistory.v1') || '[]');
  const byKind = { t2i: [], i2v: [] };
  for (const run of history) {
    for (const node of run.nodeRuns || []) {
      if (node.nodeId === '2' && node.result?.mediaId) byKind.t2i.push(node.result.mediaId);
      if (node.nodeId === '3' && node.result?.mediaId) byKind.i2v.push(node.result.mediaId);
    }
  }
  return { t2i: [...new Set(byKind.t2i)], i2v: [...new Set(byKind.i2v)] };
})()`);
console.log('BEFORE_MEDIA', JSON.stringify(before));

const actionEpochMs = Date.now();
const clicked = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => (candidate.innerText || '').trim() === 'Run Workflow');
  if (!button) return { ok: false, reason: 'not-found' };
  if (button.disabled) return { ok: false, reason: 'disabled' };
  button.click();
  return { ok: true };
})()`);
console.log('CLICK', JSON.stringify(clicked));
if (!clicked?.ok) {
  socket.close();
  process.exit(2);
}

await new Promise((resolve) => setTimeout(resolve, 1_200));
const confirmation = await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => (candidate.innerText || '').trim() === 'Run anyway');
  if (!button) return { dismissed: false };
  button.click();
  return { dismissed: true };
})()`);
console.log('CONFIRM', JSON.stringify(confirmation));

const startedAt = Date.now();
let lastState = '';
while (Date.now() - startedAt < 420_000) {
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const state = await evaluate(`(() => {
    const panel = document.querySelector('.execution-panel');
    if (!panel) return { missing: true };
    const cards = [...panel.querySelectorAll('.run-node-card')].map((card) => ({
      title: card.querySelector('.run-node-title')?.innerText?.trim(),
      status: card.querySelector('.fg-badge')?.innerText?.trim(),
      meta: card.querySelector('.run-node-meta')?.innerText?.trim(),
    }));
    return {
      head: panel.querySelector('.execution-head .fg-badge')?.innerText?.trim(),
      cards,
      summary: [...panel.querySelectorAll('.summary-row')].map((row) => row.innerText.trim()),
    };
  })()`);
  const serialized = JSON.stringify(state);
  if (serialized !== lastState) {
    console.log(new Date().toISOString(), serialized);
    lastState = serialized;
  }
  if (state?.head !== 'SUCCESS' && state?.head !== 'FAILED') continue;

  const after = await evaluate(`(() => {
    const run = JSON.parse(localStorage.getItem('flowgraph.runHistory.v1') || '[]')[0];
    return {
      runId: run?.runId,
      status: run?.status,
      projectId: run?.projectId,
      startedAt: run?.startedAt,
      finishedAt: run?.finishedAt,
      nodes: (run?.nodeRuns || []).map((node) => ({
        nodeId: node.nodeId,
        status: node.status,
        result: node.result,
        errorCode: node.errorCode,
        errorMessage: node.errorMessage,
      })),
    };
  })()`);
  const t2i = after?.nodes?.find((node) => node.nodeId === '2')?.result?.mediaId;
  const i2v = after?.nodes?.find((node) => node.nodeId === '3')?.result?.mediaId;
  const freshT2i = Boolean(t2i && !before.t2i.includes(t2i));
  const freshI2v = Boolean(i2v && !before.i2v.includes(i2v));
  const syncLogs = events
    .filter((event) => event.method === 'Runtime.consoleAPICalled'
      && Number(event.params?.timestamp || 0) >= actionEpochMs)
    .map((event) => event.params?.args?.map((arg) => arg.value ?? arg.description).join(' ') || '')
    .filter((line) => line.includes('[FlowGraph Sync]'))
    .slice(-80);
  console.log('AFTER', JSON.stringify({ ...after, freshT2i, freshI2v }));
  console.log('FINAL', JSON.stringify(state, null, 2));
  console.log('SYNC_LOGS', JSON.stringify(syncLogs));
  socket.close();
  process.exit(state.head === 'SUCCESS' && freshT2i && freshI2v ? 0 : 3);
}

console.log('FINAL_TIMEOUT');
socket.close();
process.exit(4);

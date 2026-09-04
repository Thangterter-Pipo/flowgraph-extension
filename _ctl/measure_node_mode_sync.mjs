const nodeId = process.argv[2];
const expectedMode = process.argv[3];
const preselectNodeId = process.argv[4];
if (!nodeId || !['IMAGE', 'VIDEO'].includes(expectedMode)) {
  console.error('USAGE: node measure_node_mode_sync.mjs <nodeId> <IMAGE|VIDEO>');
  process.exit(2);
}

const targets = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const studioTarget = targets.find((target) => target.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
const flowTarget = targets.find((target) => target.type === 'page' && /\/tools\/flow\/project\//.test(target.url || ''));
if (!studioTarget || !flowTarget) throw new Error('STUDIO_OR_FLOW_TARGET_NOT_FOUND');

async function connect(target) {
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
  const call = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, 10_000);
    });
  };
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || 'Runtime.evaluate failed');
    return response.result?.result?.value;
  };
  return { socket, call, evaluate, events };
}

const studio = await connect(studioTarget);
const flow = await connect(flowTarget);
await studio.call('Runtime.enable');
const nodeCenter = (id) => studio.evaluate(`(() => {
  const node = document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]');
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return rect.width && rect.height ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
})()`);
const clickStudio = async (point) => {
  if (!point) throw new Error('STUDIO_NODE_NOT_VISIBLE');
  await studio.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await studio.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await studio.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
};

await studio.call('Page.bringToFront');
if (preselectNodeId) {
  await clickStudio(await nodeCenter(preselectNodeId));
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const targetPoint = await nodeCenter(nodeId);
const startedAt = performance.now();
await clickStudio(targetPoint);
await flow.call('Page.bringToFront');

let observedMode = null;
const deadline = performance.now() + 5_000;
while (performance.now() < deadline) {
  observedMode = await flow.evaluate(`(() => {
    const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
      .find((button) => /Video ·|Nano Banana/.test(button.innerText || ''));
    if (!chip) return null;
    return (chip.innerText || '').includes('Video ·') ? 'VIDEO' : 'IMAGE';
  })()`);
  if (observedMode === expectedMode) break;
  await new Promise((resolve) => setTimeout(resolve, 40));
}
const latencyMs = Math.round(performance.now() - startedAt);
await new Promise((resolve) => setTimeout(resolve, 1_500));
const syncLogs = studio.events
  .filter((event) => event.method === 'Runtime.consoleAPICalled')
  .map((event) => event.params?.args?.map((arg) => arg.value ?? arg.description).join(' '))
  .filter((line) => line?.includes('[FlowGraph Sync]'));
studio.socket.close();
flow.socket.close();
console.log(JSON.stringify({ ok: observedMode === expectedMode, nodeId, expectedMode, observedMode, latencyMs, syncLogs }));
if (observedMode !== expectedMode) process.exit(4);

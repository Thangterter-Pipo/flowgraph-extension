const [label, studioValue, expectedFlow, projectId] = process.argv.slice(2);
if (!label || !studioValue || !expectedFlow || !projectId) {
  console.error('USAGE: node measure_forward_setting_sync.mjs <label> <studioValue> <expectedFlow> <projectId>');
  process.exit(2);
}

const targets = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const studioTarget = targets.find((target) => target.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
const flowTarget = targets.find((target) => target.type === 'page' && (target.url || '').includes(`/tools/flow/project/${projectId}`));
if (!studioTarget || !flowTarget) throw new Error('STUDIO_OR_EXACT_FLOW_PROJECT_NOT_FOUND');

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
      }, 12_000);
    });
  };
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result?.result?.value;
  };
  return { socket, call, evaluate, events };
}

const studio = await connect(studioTarget);
const flow = await connect(flowTarget);
await studio.call('Runtime.enable');
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
await studio.call('Page.bringToFront');
const select = await studio.evaluate(`((label, desired) => {
  const element = [...document.querySelectorAll('.inspector select')]
    .find((candidate) => (candidate.parentElement?.textContent || '').trim().startsWith(label));
  if (!element) return { ok: false, reason: 'STUDIO_SELECT_NOT_FOUND' };
  const desiredIndex = [...element.options].findIndex((option) => option.value === desired);
  if (desiredIndex < 0) return { ok: false, reason: 'STUDIO_OPTION_NOT_FOUND', options: [...element.options].map((option) => option.value) };
  const rect = element.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, desiredIndex };
})(${JSON.stringify(label)}, ${JSON.stringify(studioValue)})`);
if (!select?.ok) throw new Error(`${select?.reason || 'STUDIO_SELECT_NOT_FOUND'} ${JSON.stringify(select?.options || [])}`);

const startedAt = performance.now();
const actionEpochMs = Date.now();
const actionTimestamp = new Date().toISOString();
const dispatched = await studio.evaluate(`((label, desired) => {
  const element = [...document.querySelectorAll('.inspector select')]
    .find((candidate) => (candidate.parentElement?.textContent || '').trim().startsWith(label));
  if (!element) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (!setter) return false;
  setter.call(element, desired);
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})(${JSON.stringify(label)}, ${JSON.stringify(studioValue)})`);
if (!dispatched) throw new Error('STUDIO_CHANGE_DISPATCH_FAILED');
// Acceptance scenario keeps Studio and Flow visible side by side. Bringing the
// Flow renderer forward prevents Chrome background-tab timer throttling from
// inflating the DOM adapter's bounded waits during this latency measurement.
await flow.call('Page.bringToFront');

const readFlowValue = `((label) => {
  const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
    .find((button) => /Video ·|Nano Banana/.test(button.innerText || ''));
  if (!chip) return null;
  if (label === 'Model') {
    const trigger = [...document.querySelectorAll('[role="menu"][data-state="open"] button[aria-haspopup="menu"]')]
      .find((button) => /Omni|Veo|Nano Banana/.test(button.innerText || ''));
    return (trigger?.innerText || '').replace(/arrow_drop_down/gi, ' ').replace(/\\s+/g, ' ').trim() || null;
  }
  if (label === 'Aspect Ratio') {
    const icon = [...chip.querySelectorAll('i.google-symbols, .google-symbols')]
      .map((candidate) => (candidate.textContent || '').trim())
      .find((text) => /^crop_\\d+_\\d+$/.test(text));
    return icon?.replace(/^crop_/, '').replace('_', ':') || null;
  }
  if (label === 'Duration') return chip.innerText.match(/\\b(\\d+)s\\b/i)?.[1] || null;
  if (label === 'Resolution') return chip.innerText.match(/\\b(\\d{3,4}p)\\b/i)?.[1]?.toLowerCase() || null;
  return null;
})(${JSON.stringify(label)})`;
let flowApplied = null;
const deadline = performance.now() + 5_000;
while (performance.now() < deadline) {
  flowApplied = await flow.evaluate(readFlowValue);
  if (flowApplied === expectedFlow) break;
  await wait(20);
}
const latencyMs = Math.round(performance.now() - startedAt);
const studioApplied = await studio.evaluate(`((label) => [...document.querySelectorAll('.inspector select')]
  .find((candidate) => (candidate.parentElement?.textContent || '').trim().startsWith(label))?.value ?? null)(${JSON.stringify(label)})`);
await wait(700);
const syncFieldByLabel = {
  Model: 'model',
  'Aspect Ratio': 'aspectRatio',
  Duration: 'durationSeconds',
  Resolution: 'targetResolution',
};
const syncField = syncFieldByLabel[label];
const consoleLines = studio.events
  .filter((event) => event.method === 'Runtime.consoleAPICalled' && Number(event.params?.timestamp || 0) >= actionEpochMs)
  .map((event) => event.params?.args?.map((arg) => arg.value ?? arg.description).join(' ') || '');
const forwardLogCount = consoleLines.filter((line) => line.includes(`[FlowGraph Sync] ${syncField} F→G SUCCESS`)).length;
const reverseEchoLogCount = consoleLines.filter((line) => line.includes(`[FlowGraph Sync] ${syncField} G→F SUCCESS`)).length;
studio.socket.close();
flow.socket.close();
const result = {
  ok: studioApplied === studioValue && flowApplied === expectedFlow,
  direction: 'FLOWGRAPH_TO_GOOGLE_FLOW',
  field: label,
  projectId,
  actionTimestamp,
  studioApplied,
  flowApplied,
  latencyMs,
  forwardLogCount,
  reverseEchoLogCount,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

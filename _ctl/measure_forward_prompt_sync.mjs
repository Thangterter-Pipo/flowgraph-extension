const [projectId, ...promptParts] = process.argv.slice(2);
const requested = promptParts.join(' ');
if (!projectId || !requested) {
  console.error('USAGE: node measure_forward_prompt_sync.mjs <projectId> <prompt>');
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
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
      }, 15_000);
    });
  };
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result?.result?.value;
  };
  return { socket, call, evaluate };
}

const studio = await connect(studioTarget);
const flow = await connect(flowTarget);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clickAt = async (connection, point) => {
  await connection.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await connection.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await connection.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
};

await studio.call('Page.bringToFront');
const promptNode = await studio.evaluate(`(() => {
  const element = document.querySelector('.react-flow__node[data-id="p1"]');
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
if (!promptNode) throw new Error('PROMPT_NODE_NOT_FOUND');
await clickAt(studio, promptNode);

// Selecting a Prompt node resolves its single downstream generation target and
// may enqueue an initial state sync. Start typing only after that queue settles.
await flow.call('Page.bringToFront');
const settleDeadline = performance.now() + 12_000;
while (performance.now() < settleDeadline) {
  const state = await studio.evaluate(`[...document.querySelectorAll('.connection-pill')].at(-1)?.textContent.trim() ?? null`);
  if (state === 'SYNCED') break;
  await wait(100);
}

await studio.call('Page.bringToFront');
const textarea = await studio.evaluate(`(() => {
  const element = [...document.querySelectorAll('.inspector textarea')]
    .find((candidate) => (candidate.parentElement?.textContent || '').trim().startsWith('Prompt'));
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
if (!textarea) throw new Error('PROMPT_TEXTAREA_NOT_FOUND');
await clickAt(studio, textarea);
const startedAt = performance.now();
const actionTimestamp = new Date().toISOString();
const dispatched = await studio.evaluate(`((requested) => {
  const element = [...document.querySelectorAll('.inspector textarea')]
    .find((candidate) => (candidate.parentElement?.textContent || '').trim().startsWith('Prompt'));
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!element || !setter) return false;
  setter.call(element, requested);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})(${JSON.stringify(requested)})`);
if (!dispatched) throw new Error('PROMPT_CHANGE_DISPATCH_FAILED');
// Keep Studio foreground through its 250 ms prompt debounce. In a real
// side-by-side setup both pages remain visible; switching the sole test tab too
// early would make Chrome clamp Studio's timer to roughly one second.
await wait(300);
await flow.call('Page.bringToFront');

const readFlowPrompt = `(() => {
  const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
    || document.querySelector('[role="textbox"][contenteditable="true"]');
  if (!editor) return null;
  let text = '';
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest('[data-slate-placeholder="true"]')
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text += node.nodeValue || '';
  return text.replace(/\\r\\n/g, '\\n').trim();
})()`;
let flowApplied = null;
const deadline = performance.now() + 4_000;
while (performance.now() < deadline) {
  flowApplied = await flow.evaluate(readFlowPrompt);
  if (flowApplied === requested) break;
  await wait(20);
}
const latencyMs = Math.round(performance.now() - startedAt);
const studioApplied = await studio.evaluate(`document.querySelector('.react-flow__node[data-id="p1"] .node-prompt-compact')?.textContent ?? null`);
studio.socket.close();
flow.socket.close();
const result = {
  ok: studioApplied === requested && flowApplied === requested,
  direction: 'FLOWGRAPH_TO_GOOGLE_FLOW',
  field: 'prompt',
  projectId,
  actionTimestamp,
  studioApplied,
  flowApplied,
  latencyMs,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

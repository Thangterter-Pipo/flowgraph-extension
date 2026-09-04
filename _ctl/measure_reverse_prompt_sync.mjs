const [projectId, ...promptParts] = process.argv.slice(2);
const requested = promptParts.join(' ');
if (!projectId || !requested) {
  console.error('USAGE: node measure_reverse_prompt_sync.mjs <projectId> <prompt>');
  process.exit(2);
}

const targets = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const flowTarget = targets.find((target) => target.type === 'page' && (target.url || '').includes(`/tools/flow/project/${projectId}`));
const studioTarget = targets.find((target) => target.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
if (!flowTarget || !studioTarget) throw new Error('STUDIO_OR_EXACT_FLOW_PROJECT_NOT_FOUND');

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
  return { socket, call, evaluate };
}

const flow = await connect(flowTarget);
const studio = await connect(studioTarget);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
await flow.call('Page.bringToFront');
const editor = await flow.evaluate(`(() => {
  const element = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
    || document.querySelector('[role="textbox"][contenteditable="true"]');
  if (!element) return { ok: false, reason: 'EDITOR_NOT_FOUND' };
  const rect = element.getBoundingClientRect();
  return rect.width && rect.height
    ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : { ok: false, reason: 'EDITOR_NOT_VISIBLE' };
})()`);
if (!editor?.ok) throw new Error(editor?.reason || 'EDITOR_NOT_FOUND');
await flow.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: editor.x, y: editor.y });
await flow.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: editor.x, y: editor.y, button: 'left', buttons: 1, clickCount: 1 });
await flow.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: editor.x, y: editor.y, button: 'left', buttons: 0, clickCount: 1 });
await flow.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
await flow.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
await flow.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
await flow.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
const startedAt = performance.now();
const actionTimestamp = new Date().toISOString();
await flow.call('Input.insertText', { text: requested });

let studioApplied = null;
const deadline = performance.now() + 4_000;
while (performance.now() < deadline) {
  studioApplied = await studio.evaluate(`document.querySelector('.react-flow__node[data-id="p1"] .node-prompt-compact')?.textContent ?? null`);
  if (studioApplied === requested) break;
  await wait(20);
}
const latencyMs = Math.round(performance.now() - startedAt);
const flowApplied = await flow.evaluate(`(() => {
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
})()`);
flow.socket.close();
studio.socket.close();
const result = {
  ok: flowApplied === requested && studioApplied === requested,
  direction: 'GOOGLE_FLOW_TO_FLOWGRAPH',
  field: 'prompt',
  projectId,
  actionTimestamp,
  flowApplied,
  studioApplied,
  latencyMs,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

const requested = process.argv.slice(2).join(' ');
if (!requested) {
  console.error('USAGE: node physical_prompt_edit.mjs <prompt>');
  process.exit(2);
}

const pages = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = pages.find((page) =>
  page.type === 'page'
  && /labs\.google\/fx\/(?:[a-z]{2}\/)?tools\/flow\/project\//.test(page.url || '')
);
if (!target) {
  console.error('FLOW_PROJECT_NOT_FOUND');
  process.exit(3);
}

let sequence = 0;
const pending = new Map();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
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
    }, 12_000);
  });
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  const exception = response.result?.exceptionDetails;
  if (exception) throw new Error(exception.exception?.description || exception.text || 'Runtime.evaluate failed');
  return response.result?.result?.value;
}

await call('Page.bringToFront');
const editor = await evaluate(`(() => {
  const element = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
    || document.querySelector('[role="textbox"][contenteditable="true"]');
  if (!element) return { ok: false, reason: 'EDITOR_NOT_FOUND' };
  const rect = element.getBoundingClientRect();
  return rect.width && rect.height
    ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : { ok: false, reason: 'EDITOR_NOT_VISIBLE' };
})()`);
if (!editor?.ok) throw new Error(editor?.reason || 'EDITOR_NOT_FOUND');

await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: editor.x, y: editor.y });
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: editor.x, y: editor.y, button: 'left', buttons: 1, clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: editor.x, y: editor.y, button: 'left', buttons: 0, clickCount: 1 });
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
await call('Input.insertText', { text: requested });
await new Promise((resolve) => setTimeout(resolve, 500));

const applied = await evaluate(`(() => {
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
socket.close();
console.log(JSON.stringify({ ok: applied === requested, applied }));
if (applied !== requested) process.exit(4);

const projectId = process.argv[2];
if (!projectId) process.exit(2);
const targets = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && (candidate.url || '').includes(`/tools/flow/project/${projectId}`));
if (!target) throw new Error('EXACT_FLOW_PROJECT_NOT_FOUND');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  clearTimeout(entry.timeout);
  entry.resolve(message);
});
const call = (method, params = {}) => {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout ${method}`)), 10_000);
    pending.set(id, { resolve, timeout });
  });
};
const evaluate = async (expression) => {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return response.result?.result?.value;
};
await call('Page.bringToFront');
const point = await evaluate(`(() => {
  const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]');
  const editorRect = editor?.getBoundingClientRect();
  const element = [...document.querySelectorAll('[type="button"][aria-haspopup="dialog"]')]
    .find((candidate) => /^(Kết thúc|End)$/i.test((candidate.textContent || '').trim()) && (!editorRect || Math.abs(candidate.getBoundingClientRect().top - editorRect.top) < 180));
  if (!element) return { ok: false, reason: 'END_SLOT_NOT_FOUND' };
  const rect = element.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
if (!point?.ok) throw new Error(point?.reason || 'END_SLOT_NOT_FOUND');
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 500));
const state = await evaluate(`(() => ({
  dialogs: [...document.querySelectorAll('[role="dialog"]')].filter((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }).map((dialog) => ({
    text: (dialog.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1200),
    buttons: [...dialog.querySelectorAll('button')].map((button) => ({
      text: (button.innerText || button.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      aria: button.getAttribute('aria-label'),
    })).filter((item) => item.text || item.aria).slice(0, 30),
    media: [...dialog.querySelectorAll('img, video, [data-media-id]')].map((element) => {
      const values = [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src].filter(Boolean).map(String);
      const mediaId = values.map((value) => value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]).find(Boolean);
      const rect = element.getBoundingClientRect();
      return mediaId ? { mediaId, tag: element.tagName, visible: rect.width > 0 && rect.height > 0 } : null;
    }).filter(Boolean),
  })),
}))()`);
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
socket.close();
console.log(JSON.stringify(state));

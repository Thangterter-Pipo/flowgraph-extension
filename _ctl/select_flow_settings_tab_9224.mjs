const requested = process.argv.slice(2).join(' ');
if (!requested) process.exit(2);
const pages = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = pages.find((candidate) => candidate.type === 'page'
  && /\/tools\/flow\/project\//.test(candidate.url || ''));
if (!target) throw new Error('FLOW_PROJECT_NOT_FOUND');
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
  clearTimeout(entry.timer);
  entry.resolve(message);
});
function call(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
  });
}
async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true });
  return response.result?.result?.value;
}
let point = await evaluate(`((requested) => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const tab = [...document.querySelectorAll('[role="tab"]')]
    .find((candidate) => normalize(candidate.innerText).includes(normalize(requested)));
  if (!tab) return { ok: false, reason: 'tab-not-found' };
  const rect = tab.getBoundingClientRect();
  return rect.width && rect.height
    ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: normalize(tab.innerText) }
    : { ok: false, reason: 'tab-not-visible' };
})(${JSON.stringify(requested)})`);
if (!point?.ok) throw new Error(point?.reason || 'TAB_NOT_FOUND');
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 70));
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 700));
const state = await evaluate(`(() => ({
  tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
    text: (tab.innerText || '').replace(/\\s+/g, ' ').trim(),
    selected: tab.getAttribute('aria-selected'),
  })),
  bodyTail: (document.body?.innerText || '').slice(-1200),
}))()`);
socket.close();
console.log(JSON.stringify({ clicked: point.text, state }, null, 2));

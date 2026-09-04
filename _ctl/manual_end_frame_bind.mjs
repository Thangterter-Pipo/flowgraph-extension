const [projectId, mediaId] = process.argv.slice(2);
if (!projectId || !mediaId) process.exit(2);
const targets = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && (candidate.url || '').includes(`/tools/flow/project/${projectId}`));
const studioTarget = targets.find((candidate) => candidate.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(candidate.url || ''));
if (!target) throw new Error('EXACT_FLOW_PROJECT_NOT_FOUND');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
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
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || 'Runtime.evaluate failed');
  return response.result?.result?.value;
};
let studioSocket = null;
let studioSequence = 0;
const studioPending = new Map();
if (studioTarget) {
  studioSocket = new WebSocket(studioTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { studioSocket.addEventListener('open', resolve, { once: true }); studioSocket.addEventListener('error', reject, { once: true }); });
  studioSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = studioPending.get(message.id);
    if (!entry) return;
    studioPending.delete(message.id);
    clearTimeout(entry.timeout);
    entry.resolve(message);
  });
}
const evaluateStudio = async (expression) => {
  if (!studioSocket) return null;
  const id = ++studioSequence;
  studioSocket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout Studio Runtime.evaluate')), 10_000);
    studioPending.set(id, { resolve, timeout });
  });
  return response.result?.result?.value;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clickAt = async (point) => {
  if (!point?.ok) throw new Error(point?.reason || 'CLICK_TARGET_NOT_FOUND');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
};
await call('Page.bringToFront');
const endSlot = await evaluate(`(() => {
  const element = [...document.querySelectorAll('[type="button"][aria-haspopup="dialog"]')]
    .find((candidate) => /^(Kết thúc|End)$/i.test((candidate.textContent || '').trim()));
  if (!element) return { ok: false, reason: 'END_SLOT_NOT_FOUND' };
  const rect = element.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
await clickAt(endSlot);
await wait(450);
const media = await evaluate(`((mediaId) => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find((candidate) => candidate.getBoundingClientRect().width > 0);
  const matches = [...(dialog?.querySelectorAll('img, video, [data-media-id]') || [])]
    .filter((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
      .filter(Boolean).some((value) => String(value).includes(mediaId)))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  const element = matches[0]?.element;
  if (!element) return { ok: false, reason: 'EXACT_DIALOG_MEDIA_NOT_FOUND' };
  const card = element.closest('[role="button"], button') || element;
  const rect = card.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})(${JSON.stringify(mediaId)})`);
await clickAt(media);
await wait(350);
const add = await evaluate(`(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find((candidate) => candidate.getBoundingClientRect().width > 0);
  const button = [...(dialog?.querySelectorAll('button') || [])].find((candidate) => /Thêm vào câu lệnh|Add to prompt/i.test(candidate.innerText || ''));
  if (!button) return { ok: false, reason: 'ADD_TO_PROMPT_NOT_FOUND' };
  const rect = button.getBoundingClientRect();
  return { ok: !button.disabled && button.getAttribute('aria-disabled') !== 'true', reason: button.disabled ? 'ADD_TO_PROMPT_DISABLED' : undefined, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
const startedAt = performance.now();
const actionTimestamp = new Date().toISOString();
await clickAt(add);
let studioApplied = null;
if (studioSocket) {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    studioApplied = await evaluateStudio(`(() => {
      const input = [...document.querySelectorAll('.inspector input')]
        .find((candidate) => candidate.parentElement?.querySelector('.form-label')?.textContent === 'Flow End Image Media Id');
      return input?.value ?? null;
    })()`);
    if (studioApplied === mediaId) break;
    await wait(25);
  }
}
const latencyMs = Math.round(performance.now() - startedAt);
await wait(250);
const slots = await evaluate(`(() => {
  const swap = [...document.querySelectorAll('button')].find((button) =>
    [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')].some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
  const read = (root) => {
    const ids = [...(root?.querySelectorAll('img, video, [data-media-id]') || [])].map((element) =>
      [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
        .filter(Boolean).map(String).map((value) => value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]).find(Boolean))
      .filter(Boolean);
    return [...new Set(ids)][0] || null;
  };
  return { startImage: read(swap?.previousElementSibling), endImage: read(swap?.nextElementSibling) };
})()`);
socket.close();
studioSocket?.close();
const ok = slots?.endImage === mediaId && (!studioTarget || studioApplied === mediaId);
console.log(JSON.stringify({ ok, direction: 'GOOGLE_FLOW_TO_FLOWGRAPH', field: 'endImage', projectId, mediaId, actionTimestamp, slots, studioApplied, latencyMs }));
if (!ok) process.exit(4);

const [projectId, mediaId] = process.argv.slice(2);
if (!projectId || !mediaId) {
  console.error('USAGE: node inspect_media_actions_9224.mjs <projectId> <mediaId>');
  process.exit(2);
}
const targets = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page'
  && (candidate.url || '').includes(`/tools/flow/project/${projectId}`));
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
  clearTimeout(entry.timer);
  entry.resolve(message);
});
function call(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
  });
}
async function evaluate(expression) {
  const message = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (message.result?.exceptionDetails) throw new Error(message.result.exceptionDetails.text || 'Runtime.evaluate failed');
  return message.result?.result?.value;
}
const tile = await evaluate(`((mediaId) => {
  const matches = [...document.querySelectorAll('img, video, a, [data-media-id]')]
    .filter((element) => [
      element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'),
      element.currentSrc, element.src, element.href,
    ].filter(Boolean).some((value) => String(value).includes(mediaId)))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  const media = matches[0]?.element;
  const card = media?.closest?.('[role="button"]') || media?.parentElement;
  if (!media || !card) return { ok: false, reason: 'visible-media-card-not-found' };
  card.scrollIntoView?.({ block: 'center', inline: 'center' });
  const rect = card.getBoundingClientRect();
  return { ok: true, tag: media.tagName, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})(${JSON.stringify(mediaId)})`);
if (!tile?.ok) throw new Error(tile?.reason || 'MEDIA_TILE_NOT_FOUND');
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tile.x, y: tile.y });
await new Promise((resolve) => setTimeout(resolve, 450));
const more = await evaluate(`((mediaId) => {
  const media = [...document.querySelectorAll('img, video, a, [data-media-id]')].find((element) => [
    element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'),
    element.currentSrc, element.src, element.href,
  ].filter(Boolean).some((value) => String(value).includes(mediaId)));
  const card = media?.closest?.('[role="button"]') || media?.parentElement;
  const button = [...(card?.querySelectorAll('button') || [])].find((candidate) =>
    [...candidate.querySelectorAll('i.google-symbols, .google-symbols')]
      .some((icon) => (icon.textContent || '').trim() === 'more_vert'));
  if (!button) return { ok: false, reason: 'more-vert-not-found' };
  const rect = button.getBoundingClientRect();
  return rect.width && rect.height
    ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : { ok: false, reason: 'more-vert-not-visible' };
})(${JSON.stringify(mediaId)})`);
if (!more?.ok) throw new Error(more?.reason || 'MORE_MENU_NOT_FOUND');
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: more.x, y: more.y });
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: more.x, y: more.y, button: 'left', buttons: 1, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 70));
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: more.x, y: more.y, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 500));
const menu = await evaluate(`(() => {
  const menus = [...document.querySelectorAll('[role="menu"]')]
    .filter((candidate) => candidate.getBoundingClientRect().width > 0 && candidate.getBoundingClientRect().height > 0);
  return menus.map((root) => ({
    state: root.getAttribute('data-state'),
    actions: [...root.querySelectorAll('[role="menuitem"], button')].map((item) => ({
      text: (item.innerText || '').replace(/\\s+/g, ' ').trim(),
      icons: [...item.querySelectorAll('i.google-symbols, .google-symbols')]
        .map((icon) => (icon.textContent || '').trim()).filter(Boolean),
      disabled: item.disabled || item.getAttribute('aria-disabled') === 'true',
    })),
  }));
})()`);
socket.close();
console.log(JSON.stringify({ projectId, mediaId, mediaTag: tile.tag, menus: menu }, null, 2));

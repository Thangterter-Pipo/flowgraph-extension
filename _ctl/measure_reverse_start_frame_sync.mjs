const [projectId, mediaId] = process.argv.slice(2);
if (!projectId || !mediaId) {
  console.error('USAGE: node measure_reverse_start_frame_sync.mjs <projectId> <mediaId>');
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
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, 12_000);
      pending.set(id, { resolve, timeout });
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
const clickAt = async (point) => {
  if (!point?.ok) throw new Error(point?.reason || 'CLICK_TARGET_NOT_FOUND');
  await flow.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await flow.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await flow.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
};
await flow.call('Page.bringToFront');

const boundControl = await flow.evaluate(`((mediaId) => {
  const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]');
  if (!editor) return null;
  const editorRect = editor.getBoundingClientRect();
  const image = [...document.querySelectorAll('img, video')].find((element) => {
    const source = String(element.currentSrc || element.src || '');
    const rect = element.getBoundingClientRect();
    return source.includes(mediaId) && rect.bottom >= editorRect.top - 180 && rect.top <= editorRect.bottom + 180
      && rect.width > 0 && rect.height > 0 && rect.width <= 140 && rect.height <= 140;
  });
  const button = image?.closest('button');
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})(${JSON.stringify(mediaId)})`);
if (boundControl) {
  await clickAt(boundControl);
  await wait(500);
}

const sourceTile = await flow.evaluate(`((mediaId) => {
  const matches = [...document.querySelectorAll('img, video, a, [data-media-id]')]
    .filter((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'), element.currentSrc, element.src, element.href]
      .filter(Boolean).some((value) => String(value).includes(mediaId)))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 140 && rect.height > 100)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  const media = matches[0]?.element;
  const card = media?.closest('[role="button"]') || media?.parentElement;
  if (!media || !card) return { ok: false, reason: 'EXACT_SOURCE_TILE_NOT_FOUND' };
  const rect = card.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})(${JSON.stringify(mediaId)})`);
await flow.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sourceTile.x, y: sourceTile.y });
await wait(450);
const more = await flow.evaluate(`((mediaId) => {
  const media = [...document.querySelectorAll('img, video, a, [data-media-id]')]
    .filter((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'), element.currentSrc, element.src, element.href]
      .filter(Boolean).some((value) => String(value).includes(mediaId)))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 140 && rect.height > 100)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]?.element;
  const card = media?.closest('[role="button"]') || media?.parentElement;
  const scopes = [card, card?.parentElement, card?.parentElement?.parentElement].filter(Boolean);
  const button = scopes.flatMap((scope) => [...scope.querySelectorAll('button')]).find((candidate) =>
    [...candidate.querySelectorAll('i.google-symbols, .google-symbols')].some((icon) => (icon.textContent || '').trim() === 'more_vert')
    || (candidate.getAttribute('aria-label') || '').toLowerCase().includes('khác')
    || (candidate.getAttribute('aria-label') || '').toLowerCase().includes('more'));
  if (!button) return { ok: false, reason: 'EXACT_SOURCE_MORE_MENU_NOT_FOUND' };
  const rect = button.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})(${JSON.stringify(mediaId)})`);
await clickAt(more);
await wait(500);
const animate = await flow.evaluate(`(() => {
  const item = [...document.querySelectorAll('[role="menu"][data-state="open"] [role="menuitem"], [role="menu"][data-state="open"] button')]
    .find((candidate) => (candidate.textContent || '').includes('motion_blur') || /Tạo ảnh động|Animate/i.test(candidate.innerText || ''));
  if (!item) return { ok: false, reason: 'ANIMATE_ACTION_NOT_FOUND' };
  const rect = item.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
const startedAt = performance.now();
const actionTimestamp = new Date().toISOString();
await clickAt(animate);

let studioApplied = null;
const deadline = performance.now() + 5_000;
while (performance.now() < deadline) {
  studioApplied = await studio.evaluate(`(() => {
    const input = [...document.querySelectorAll('.inspector input')]
      .find((candidate) => (candidate.parentElement?.querySelector('.form-label')?.textContent || '') === 'Flow Start Image Media Id');
    return input?.value ?? null;
  })()`);
  if (studioApplied === mediaId) break;
  await wait(25);
}
const latencyMs = Math.round(performance.now() - startedAt);
const bound = await flow.evaluate(`((mediaId) => {
  const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]');
  if (!editor) return false;
  const editorRect = editor.getBoundingClientRect();
  return [...document.querySelectorAll('img, video')].some((element) => {
    const rect = element.getBoundingClientRect();
    return String(element.currentSrc || element.src || '').includes(mediaId)
      && rect.bottom >= editorRect.top - 180 && rect.top <= editorRect.bottom + 180
      && rect.width > 0 && rect.height > 0 && rect.width <= 140 && rect.height <= 140;
  });
})(${JSON.stringify(mediaId)})`);
flow.socket.close();
studio.socket.close();
const result = {
  ok: bound === true && studioApplied === mediaId,
  direction: 'GOOGLE_FLOW_TO_FLOWGRAPH',
  field: 'startImage',
  projectId,
  mediaId,
  actionTimestamp,
  bound,
  studioApplied,
  latencyMs,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

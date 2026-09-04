const [projectId, removeMediaId, ...expectedIds] = process.argv.slice(2);
if (!projectId || !removeMediaId) {
  console.error('USAGE: node measure_reverse_reference_sync.mjs <projectId> <removeMediaId> [expectedMediaId...]');
  process.exit(2);
}
const targets = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const flowTarget = targets.find((target) => target.type === 'page'
  && (target.url || '').includes(`/tools/flow/project/${projectId}`));
const studioTarget = targets.find((target) => target.type === 'page'
  && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
if (!flowTarget || !studioTarget) throw new Error('STUDIO_OR_EXACT_FLOW_PROJECT_NOT_FOUND');

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
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(message);
  });
  const call = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, 15_000);
      pending.set(id, { resolve, reject, timer });
    });
  };
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || 'Runtime.evaluate failed');
    return response.result?.result?.value;
  };
  return { socket, call, evaluate, events };
}

const flow = await connect(flowTarget);
const studio = await connect(studioTarget);
await studio.call('Runtime.enable');
await flow.call('Page.bringToFront');
const point = await flow.evaluate(`((mediaId) => {
  const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
    || document.querySelector('[role="textbox"][contenteditable="true"]');
  if (!editor) return { ok: false, reason: 'editor-not-found' };
  const editorRect = editor.getBoundingClientRect();
  const button = [...document.querySelectorAll('button')].find((candidate) => {
    const exact = [...candidate.querySelectorAll('img, video, [data-media-id]')]
      .some((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
        .filter(Boolean).some((value) => String(value).includes(mediaId)));
    const cancel = [...candidate.querySelectorAll('i.google-symbols, .google-symbols')]
      .some((icon) => (icon.textContent || '').trim() === 'cancel');
    const rect = candidate.getBoundingClientRect();
    return exact && cancel && rect.width > 0 && rect.height > 0 && rect.width <= 90 && rect.height <= 90
      && rect.bottom >= editorRect.top - 220 && rect.top <= editorRect.bottom + 80;
  });
  if (!button) return { ok: false, reason: 'exact-reference-chip-not-found' };
  const rect = button.getBoundingClientRect();
  const xs = [rect.right - 5, rect.left + rect.width / 2, rect.left + 5];
  const ys = [rect.top + rect.height / 2, rect.bottom - 5, rect.top + 5];
  for (const x of xs) {
    for (const y of ys) {
      if (document.elementFromPoint(x, y)?.closest?.('button') === button) {
        return { ok: true, x, y };
      }
    }
  }
  return { ok: false, reason: 'exact-reference-chip-occluded' };
})(${JSON.stringify(removeMediaId)})`);
if (!point?.ok) throw new Error(point?.reason || 'REFERENCE_CHIP_NOT_FOUND');

await flow.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
const hitCheck = await flow.evaluate(`((x, y, mediaId) => {
  const hit = document.elementFromPoint(x, y);
  const button = hit?.closest?.('button');
  const exact = [...(button?.querySelectorAll('img, video, [data-media-id]') || [])]
    .some((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
      .filter(Boolean).some((value) => String(value).includes(mediaId)));
  const cancel = [...(button?.querySelectorAll('i.google-symbols, .google-symbols') || [])]
    .some((icon) => (icon.textContent || '').trim() === 'cancel');
  return { ok: Boolean(button && exact && cancel), hit: hit?.tagName || null };
})(${point.x}, ${point.y}, ${JSON.stringify(removeMediaId)})`);
if (!hitCheck?.ok) throw new Error(`REFERENCE_HIT_TEST_FAILED ${JSON.stringify({ point, hitCheck })}`);

const actionEpochMs = Date.now();
const actionTimestamp = new Date().toISOString();
const startedAt = performance.now();
await flow.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
await new Promise((resolve) => setTimeout(resolve, 70));
await flow.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });

const expected = expectedIds.join(',');
let studioApplied = null;
const deadline = performance.now() + 5_000;
while (performance.now() < deadline) {
  studioApplied = await studio.evaluate(`(() => [...document.querySelectorAll('.inspector input')]
    .map((input) => input.value)
    .find((value) => value === ${JSON.stringify(expected)}) ?? null)()`);
  if (studioApplied === expected) break;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
const latencyMs = Math.round(performance.now() - startedAt);
const flowApplied = await flow.evaluate(`(() => {
  const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
    || document.querySelector('[role="textbox"][contenteditable="true"]');
  if (!editor) return [];
  const editorRect = editor.getBoundingClientRect();
  return [...document.querySelectorAll('button')]
    .filter((button) => [...button.querySelectorAll('i.google-symbols, .google-symbols')]
      .some((icon) => (icon.textContent || '').trim() === 'cancel'))
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.width <= 90 && rect.height <= 90
        && rect.bottom >= editorRect.top - 220 && rect.top <= editorRect.bottom + 80;
    })
    .map((button) => [...button.querySelectorAll('img, video, [data-media-id]')]
      .flatMap((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
        .filter(Boolean).map(String))
      .map((value) => value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]).find(Boolean))
    .filter(Boolean);
})()`);
await new Promise((resolve) => setTimeout(resolve, 300));
const syncLines = studio.events
  .filter((event) => event.method === 'Runtime.consoleAPICalled'
    && Number(event.params?.timestamp || 0) >= actionEpochMs)
  .map((event) => event.params?.args?.map((arg) => arg.value ?? arg.description).join(' ') || '')
  .filter((line) => line.includes('[FlowGraph Sync]'));
const logCount = syncLines
  .filter((line) => line.includes('referenceMedia G→F SUCCESS')).length;
flow.socket.close();
studio.socket.close();
const result = {
  ok: JSON.stringify(flowApplied) === JSON.stringify(expectedIds)
    && studioApplied === expected,
  direction: 'GOOGLE_FLOW_TO_FLOWGRAPH',
  field: 'referenceMedia',
  projectId,
  removedMediaId: removeMediaId,
  expectedMediaIds: expectedIds,
  flowApplied,
  studioApplied,
  actionTimestamp,
  latencyMs,
  successLogCount: logCount,
  syncLines,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

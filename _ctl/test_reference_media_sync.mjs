const [projectId, ...mediaIds] = process.argv.slice(2);
if (!projectId || mediaIds.length === 0) {
  console.error('USAGE: node test_reference_media_sync.mjs <projectId> <mediaId> [mediaId...]');
  process.exit(2);
}
const listTargets = () => fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());

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
    clearTimeout(entry.timer);
    entry.resolve(message);
  });
  const evaluate = (expression, timeoutMs = 45_000) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Runtime.evaluate timeout')); }, timeoutMs);
      pending.set(id, {
        timer,
        resolve: (message) => {
          if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text || 'Runtime.evaluate failed'));
          else resolve(message.result?.result?.value);
        },
      });
    });
  };
  return { socket, evaluate };
}

let targets = await listTargets();
const exactFlow = targets.find((target) => target.type === 'page'
  && (target.url || '').includes(`/tools/flow/project/${projectId}`));
const studioTarget = targets.find((target) => target.type === 'page'
  && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
if (!exactFlow || !studioTarget) throw new Error('STUDIO_OR_EXACT_FLOW_PROJECT_NOT_FOUND');

const flowProbe = await connect(exactFlow);
const sourceCheck = await flowProbe.evaluate(`((mediaIds) => mediaIds.map((mediaId) => {
  const matches = [...document.querySelectorAll('img, video, a, [data-media-id]')]
    .filter((element) => [
      element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'),
      element.currentSrc, element.src, element.href,
    ].filter(Boolean).some((value) => String(value).includes(mediaId)));
  return {
    mediaId,
    found: matches.length > 0,
    visible: matches.some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }),
  };
}))(${JSON.stringify(mediaIds)})`);
flowProbe.socket.close();
if (sourceCheck.some((source) => !source.found || !source.visible)) {
  throw new Error(`EXACT_VISIBLE_REFERENCE_SOURCE_NOT_FOUND ${JSON.stringify(sourceCheck)}`);
}

const studio = await connect(studioTarget);
const actionTimestamp = new Date().toISOString();
const startedAt = performance.now();
const modeResponse = await studio.evaluate(`new Promise((resolve) => {
  const requestId = 'live-reference-mode-' + crypto.randomUUID();
  chrome.runtime.sendMessage({
    type: 'FLOWGRAPH_SYNC_SET_MODE',
    requestId,
    payload: {
      syncId: requestId,
      projectId: ${JSON.stringify(projectId)},
      nodeId: 'reference-live',
      value: 'VIDEO',
      sequence: 1,
      originEventId: requestId,
    },
  }, (reply) => resolve(chrome.runtime.lastError
    ? { ok: false, error: { code: 'BRIDGE_UNAVAILABLE', message: chrome.runtime.lastError.message } }
    : reply));
})`, 20_000);
if (modeResponse?.ok !== true) {
  throw new Error(`REFERENCE_VIDEO_MODE_FAILED ${JSON.stringify(modeResponse?.error || null)}`);
}
const response = await studio.evaluate(`new Promise((resolve) => {
  const requestId = 'live-reference-media-' + crypto.randomUUID();
  chrome.runtime.sendMessage({
    type: 'FLOWGRAPH_SYNC_REFERENCE_MEDIA',
    requestId,
    payload: {
      syncId: requestId,
      projectId: ${JSON.stringify(projectId)},
      nodeId: 'reference-live',
      value: ${JSON.stringify(mediaIds.map((mediaId) => ({ mediaId })))},
      sequence: 1,
      originEventId: requestId,
    },
  }, (reply) => resolve(chrome.runtime.lastError
    ? { ok: false, error: { code: 'BRIDGE_UNAVAILABLE', message: chrome.runtime.lastError.message } }
    : reply));
})`, 45_000);
const latencyMs = Math.round(performance.now() - startedAt);
studio.socket.close();

targets = await listTargets();
const flowTarget = targets.find((target) => target.type === 'page'
  && (target.url || '').includes(`/tools/flow/project/${projectId}`));
if (!flowTarget) throw new Error('EXACT_FLOW_PROJECT_DISAPPEARED');
const flow = await connect(flowTarget);
const applied = await flow.evaluate(`(() => {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
    || document.querySelector('[role="textbox"][contenteditable="true"]');
  if (!editor) return [];
  const editorRect = editor.getBoundingClientRect();
  const swap = [...document.querySelectorAll('button')].find((button) =>
    [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
      .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
  const frameRoots = [swap?.previousElementSibling, swap?.nextElementSibling].filter(Boolean);
  return [...new Set([...document.querySelectorAll('button')]
    .filter((button) => [...button.querySelectorAll('i.google-symbols, .google-symbols')]
      .some((icon) => (icon.textContent || '').trim() === 'cancel'))
    .filter((button) => !frameRoots.some((root) => root.contains(button)))
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.width <= 90 && rect.height <= 90
        && rect.bottom >= editorRect.top - 220 && rect.top <= editorRect.bottom + 80;
    })
    .map((button) => [...button.querySelectorAll('img, video, [data-media-id]')]
      .flatMap((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
        .filter(Boolean).map(String))
      .map((value) => value.match(uuid)?.[0]).find(Boolean))
    .filter(Boolean))];
})()`);
flow.socket.close();

const result = {
  ok: response?.ok === true && JSON.stringify(applied) === JSON.stringify(mediaIds),
  direction: 'FLOWGRAPH_TO_GOOGLE_FLOW',
  field: 'referenceMedia',
  projectId,
  mediaIds,
  sourceCheck,
  actionTimestamp,
  responseCode: response?.error?.code ?? null,
  responseMessage: response?.error?.message ?? null,
  applied,
  latencyMs,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

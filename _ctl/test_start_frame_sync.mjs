const [projectId, mediaId, nodeId = 'i2v-live'] = process.argv.slice(2);
if (!projectId || !mediaId) {
  console.error('USAGE: node test_start_frame_sync.mjs <projectId> <mediaId> [nodeId]');
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
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  });
  const call = (method, params = {}, timeoutMs = 20_000) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, timeoutMs);
    });
  };
  const evaluate = async (expression, timeoutMs) => {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result?.result?.value;
  };
  return { socket, evaluate };
}

let targets = await listTargets();
const studioTarget = targets.find((target) => target.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
const exactFlow = targets.find((target) => target.type === 'page' && (target.url || '').includes(`/tools/flow/project/${projectId}`));
if (!studioTarget || !exactFlow) throw new Error('STUDIO_OR_EXACT_FLOW_PROJECT_NOT_FOUND');

// Validate the requested source before asking the worker to attach its own
// debugger. Close this CDP session first so it cannot conflict with the worker.
const sourceProbe = await connect(exactFlow);
const source = await sourceProbe.evaluate(`((mediaId) => {
  const elements = [...document.querySelectorAll('img, video, a, [data-media-id]')]
    .filter((element) => [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.getAttribute?.('href'), element.currentSrc, element.src, element.href]
      .filter(Boolean).some((value) => String(value).includes(mediaId)));
  return {
    found: elements.length > 0,
    image: elements.some((element) => element.tagName === 'IMG'),
    visible: elements.some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }),
  };
})(${JSON.stringify(mediaId)})`);
sourceProbe.socket.close();
if (!source?.found || !source.image || !source.visible) throw new Error('EXACT_VISIBLE_IMAGE_SOURCE_NOT_FOUND');

const studio = await connect(studioTarget);
const actionTimestamp = new Date().toISOString();
const startedAt = performance.now();
const response = await studio.evaluate(`new Promise((resolve) => {
  const requestId = 'live-start-frame-' + crypto.randomUUID();
  chrome.runtime.sendMessage({
    type: 'FLOWGRAPH_SYNC_START_FRAME',
    requestId,
    payload: {
      syncId: requestId,
      projectId: ${JSON.stringify(projectId)},
      nodeId: ${JSON.stringify(nodeId)},
      value: { mediaId: ${JSON.stringify(mediaId)} },
      sequence: 1,
      originEventId: requestId,
    },
  }, (reply) => {
    if (chrome.runtime.lastError) resolve({ ok: false, error: { code: 'BRIDGE_UNAVAILABLE', message: chrome.runtime.lastError.message } });
    else resolve(reply);
  });
})`, 20_000);
const latencyMs = Math.round(performance.now() - startedAt);
studio.socket.close();

targets = await listTargets();
const flowTarget = targets.find((target) => target.type === 'page' && (target.url || '').includes(`/tools/flow/project/${projectId}`));
if (!flowTarget) throw new Error('EXACT_FLOW_PROJECT_DISAPPEARED');
const flow = await connect(flowTarget);
const verification = await flow.evaluate(`((mediaId) => {
  const editor = document.querySelector('[data-slate-editor="true"][contenteditable="true"]')
    || document.querySelector('[role="textbox"][contenteditable="true"]');
  if (!editor) return { bound: false, reason: 'EDITOR_NOT_FOUND' };
  const editorRect = editor.getBoundingClientRect();
  const matches = [...document.querySelectorAll('img, video')].filter((element) => {
    const source = String(element.currentSrc || element.src || element.getAttribute('src') || '');
    if (!source.includes(mediaId)) return false;
    const rect = element.getBoundingClientRect();
    const nearComposer = rect.bottom >= editorRect.top - 180 && rect.top <= editorRect.bottom + 180;
    return nearComposer && rect.width > 0 && rect.height > 0 && rect.width <= 140 && rect.height <= 140;
  });
  return { bound: matches.length === 1, matchCount: matches.length };
})(${JSON.stringify(mediaId)})`);
flow.socket.close();

const result = {
  ok: response?.ok === true && verification?.bound === true,
  direction: 'FLOWGRAPH_TO_GOOGLE_FLOW',
  field: 'startImage',
  projectId,
  nodeId,
  mediaId,
  actionTimestamp,
  source,
  responseCode: response?.error?.code ?? null,
  bound: verification?.bound === true,
  exactBoundMatchCount: verification?.matchCount ?? 0,
  latencyMs,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

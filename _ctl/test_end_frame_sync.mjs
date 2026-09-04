const [projectId, mediaId, nodeId = 'interpolation-live'] = process.argv.slice(2);
if (!projectId || !mediaId) process.exit(2);
const listTargets = () => fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
async function evaluateTarget(target, expression, timeoutMs = 20_000) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Runtime.evaluate timeout')), timeoutMs);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      resolve(message);
    });
  });
  socket.close();
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || 'Runtime.evaluate failed');
  return response.result?.result?.value;
}

let targets = await listTargets();
const studio = targets.find((target) => target.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
if (!studio) throw new Error('STUDIO_NOT_FOUND');
const actionTimestamp = new Date().toISOString();
const startedAt = performance.now();
const response = await evaluateTarget(studio, `new Promise((resolve) => {
  const requestId = 'live-end-frame-' + crypto.randomUUID();
  chrome.runtime.sendMessage({
    type: 'FLOWGRAPH_SYNC_END_FRAME',
    requestId,
    payload: {
      syncId: requestId,
      projectId: ${JSON.stringify(projectId)},
      nodeId: ${JSON.stringify(nodeId)},
      value: { mediaId: ${JSON.stringify(mediaId)} },
      sequence: 1,
      originEventId: requestId,
    },
  }, (reply) => resolve(chrome.runtime.lastError
    ? { ok: false, error: { code: 'BRIDGE_UNAVAILABLE', message: chrome.runtime.lastError.message } }
    : reply));
})`);
const latencyMs = Math.round(performance.now() - startedAt);
targets = await listTargets();
const flow = targets.find((target) => target.type === 'page' && (target.url || '').includes(`/tools/flow/project/${projectId}`));
if (!flow) throw new Error('EXACT_FLOW_PROJECT_NOT_FOUND');
const slots = await evaluateTarget(flow, `(() => {
  const swap = [...document.querySelectorAll('button')].find((button) =>
    [...button.querySelectorAll('i.google-symbols, .google-symbols, i.material-icons')]
      .some((icon) => (icon.textContent || '').trim() === 'swap_horiz'));
  const read = (root) => {
    const ids = [...(root?.querySelectorAll('img, video, [data-media-id]') || [])].map((element) =>
      [element.getAttribute?.('data-media-id'), element.getAttribute?.('src'), element.currentSrc, element.src]
        .filter(Boolean).map(String).map((value) => value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]).find(Boolean))
      .filter(Boolean);
    return [...new Set(ids)][0] || null;
  };
  return { startImage: read(swap?.previousElementSibling), endImage: read(swap?.nextElementSibling) };
})()`);
const result = {
  ok: response?.ok === true && slots?.endImage === mediaId,
  direction: 'FLOWGRAPH_TO_GOOGLE_FLOW',
  field: 'endImage',
  projectId,
  nodeId,
  mediaId,
  actionTimestamp,
  responseCode: response?.error?.code ?? null,
  responseMessage: response?.error?.message ?? null,
  slots,
  latencyMs,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

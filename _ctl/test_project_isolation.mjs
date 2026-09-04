const [projectId, wrongProjectId] = process.argv.slice(2);
if (!projectId || !wrongProjectId || projectId === wrongProjectId) {
  console.error('USAGE: node test_project_isolation.mjs <activeProjectId> <differentProjectId>');
  process.exit(2);
}

const listTargets = () => fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
async function evaluateTarget(target, expression, timeoutMs = 12_000) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
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

const readPromptExpression = `(() => {
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
  return text.trim();
})()`;

let targets = await listTargets();
let flow = targets.find((target) => target.type === 'page' && (target.url || '').includes(`/tools/flow/project/${projectId}`));
const studio = targets.find((target) => target.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
if (!flow || !studio) throw new Error('STUDIO_OR_EXACT_FLOW_PROJECT_NOT_FOUND');
const before = await evaluateTarget(flow, readPromptExpression);
const requestTimestamp = new Date().toISOString();
const response = await evaluateTarget(studio, `new Promise((resolve) => {
  const requestId = 'project-isolation-' + crypto.randomUUID();
  chrome.runtime.sendMessage({
    type: 'FLOWGRAPH_SYNC_SET_PROMPT',
    requestId,
    payload: {
      syncId: requestId,
      projectId: ${JSON.stringify(wrongProjectId)},
      nodeId: 'isolation-probe',
      value: 'THIS MUST NOT CROSS THE PROJECT BOUNDARY',
      sequence: 1,
      originEventId: requestId,
    },
  }, (reply) => {
    if (chrome.runtime.lastError) resolve({ ok: false, error: { code: 'BRIDGE_UNAVAILABLE' } });
    else resolve(reply);
  });
})`);
targets = await listTargets();
flow = targets.find((target) => target.type === 'page' && (target.url || '').includes(`/tools/flow/project/${projectId}`));
if (!flow) throw new Error('EXACT_FLOW_PROJECT_DISAPPEARED');
const after = await evaluateTarget(flow, readPromptExpression);
const result = {
  ok: response?.ok === false && response?.error?.code === 'PROJECT_MISMATCH' && before === after,
  activeProjectId: projectId,
  attemptedProjectId: wrongProjectId,
  requestTimestamp,
  responseCode: response?.error?.code ?? null,
  uiUnchanged: before === after,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

const requested = process.argv[2] || 'Veo 3.1 - Quality';
const projectId = process.argv[3];
const studioExpected = process.argv[4] || requested;
const pages = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = pages.find((page) =>
  page.type === 'page'
  && (projectId
    ? (page.url || '').includes(`/tools/flow/project/${projectId}`)
    : /labs\.google\/fx\/(?:[a-z]{2}\/)?tools\/flow\/project\//.test(page.url || ''))
);
const studioTarget = pages.find((page) => page.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(page.url || ''));
if (!target) {
  console.error('FLOW_PROJECT_NOT_FOUND');
  process.exit(2);
}

let sequence = 0;
const pending = new Map();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

function call(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, 12_000);
  });
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const exception = response.result?.exceptionDetails;
  if (exception) throw new Error(exception.exception?.description || exception.text || 'Runtime.evaluate failed');
  return response.result?.result?.value;
}

let studioSocket = null;
let studioSequence = 0;
const studioPending = new Map();
if (studioTarget) {
  studioSocket = new WebSocket(studioTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    studioSocket.addEventListener('open', resolve, { once: true });
    studioSocket.addEventListener('error', reject, { once: true });
  });
  studioSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const resolve = studioPending.get(message.id);
    if (!resolve) return;
    studioPending.delete(message.id);
    resolve(message);
  });
}

async function evaluateStudio(expression) {
  if (!studioSocket) return null;
  const id = ++studioSequence;
  studioSocket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  const response = await new Promise((resolve, reject) => {
    studioPending.set(id, resolve);
    setTimeout(() => {
      if (!studioPending.has(id)) return;
      studioPending.delete(id);
      reject(new Error('timeout Runtime.evaluate Studio'));
    }, 12_000);
  });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text || 'Studio Runtime.evaluate failed');
  return response.result?.result?.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function physicalClick(point) {
  if (!point?.ok) throw new Error(point?.reason || 'CLICK_TARGET_NOT_FOUND');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await call('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await wait(80);
  await call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
  });
}

async function pressEscape() {
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  });
}

function centerExpression(selectorExpression) {
  return `(() => {
    const element = ${selectorExpression};
    if (!element) return { ok: false, reason: 'ELEMENT_NOT_FOUND' };
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return { ok: false, reason: 'ELEMENT_NOT_VISIBLE' };
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      text: (element.innerText || '').replace(/\\s+/g, ' ').trim() };
  })()`;
}

await call('Page.bringToFront');
await pressEscape();
await wait(150);

const chip = await evaluate(centerExpression(
  `[...document.querySelectorAll('button[aria-haspopup="menu"]')]
    .find((button) => /Video ·|Nano Banana/.test(button.innerText || ''))`,
));
await physicalClick(chip);
await wait(500);

const modelTrigger = await evaluate(centerExpression(
  `[...document.querySelectorAll('[role="menu"][data-state="open"] button[aria-haspopup="menu"]')]
    .find((button) => /Omni|Veo|Nano Banana/.test(button.innerText || ''))`,
));
await physicalClick(modelTrigger);
await wait(500);

const item = await evaluate(centerExpression(
  `[...document.querySelectorAll('[role="menu"][data-state="open"] [role="menuitem"]')]
    .find((element) => {
      const text = (element.innerText || '').replace(/\\s+/g, ' ').trim();
      return text === ${JSON.stringify(requested)} || text.endsWith(' ${requested.replace(/'/g, "\\'")}');
    })`,
));
console.log('ITEM', JSON.stringify(item));
const startedAt = performance.now();
const actionTimestamp = new Date().toISOString();
await physicalClick(item);
let studioApplied = null;
let studioLatencyMs = null;
if (studioSocket) {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    studioApplied = await evaluateStudio(`(() => {
      const select = [...document.querySelectorAll('.inspector select')]
        .find((candidate) => (candidate.parentElement?.textContent || '').trim().startsWith('Model'));
      return select?.value ?? null;
    })()`);
    if (studioApplied === studioExpected) break;
    await wait(20);
  }
  studioLatencyMs = Math.round(performance.now() - startedAt);
}
await wait(700);

let applied = null;
let verification = null;
for (let attempt = 0; attempt < 3 && !applied; attempt += 1) {
  await pressEscape();
  await wait(250);
  const verifyChip = await evaluate(centerExpression(
    `[...document.querySelectorAll('button[aria-haspopup="menu"]')]
      .find((button) => /Video ·|Nano Banana/.test(button.innerText || ''))`,
  ));
  await physicalClick(verifyChip);
  await wait(600);
  verification = await evaluate(`(() => {
    const menus = [...document.querySelectorAll('[role="menu"][data-state="open"]')];
    const trigger = menus.flatMap((menu) => [...menu.querySelectorAll('button[aria-haspopup="menu"]')])
      .find((button) => /Omni|Veo|Nano Banana/.test(button.innerText || ''));
    return {
      model: (trigger?.innerText || '').replace(/arrow_drop_down/g, '').replace(/\\s+/g, ' ').trim() || null,
      menus: menus.map((menu) => (menu.innerText || '').replace(/\\s+/g, ' ').trim()),
    };
  })()`);
  applied = verification?.model ?? null;
}
await pressEscape();
socket.close();
studioSocket?.close();

console.log('PHYSICAL_CLICKED');
console.log('APPLIED', JSON.stringify(applied));
if (!applied) console.log('VERIFY', JSON.stringify(verification));
console.log(JSON.stringify({
  ok: applied === requested && (!studioSocket || studioApplied === studioExpected),
  direction: 'GOOGLE_FLOW_TO_FLOWGRAPH',
  field: 'model',
  projectId: projectId || null,
  actionTimestamp,
  flowApplied: applied,
  studioApplied,
  latencyMs: studioLatencyMs,
}));
if (applied !== requested || (studioTarget && studioApplied !== studioExpected)) process.exit(4);

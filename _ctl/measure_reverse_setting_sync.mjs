const [field, requested, studioExpected, projectId] = process.argv.slice(2);
if (!['aspectRatio', 'durationSeconds', 'targetResolution', 'mode'].includes(field)
  || !requested || !studioExpected || !projectId) {
  console.error('USAGE: node measure_reverse_setting_sync.mjs <field> <flowValue> <studioValue> <projectId>');
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
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  });
  const call = (method, params = {}) => {
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
const clickAt = async (connection, point) => {
  if (!point?.ok) throw new Error(point?.reason || 'CONTROL_NOT_FOUND');
  await connection.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await connection.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await connection.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
};

await flow.call('Page.bringToFront');
await flow.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await flow.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
const chip = await flow.evaluate(`(() => {
  const element = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
    .find((button) => /Video ·|Nano Banana/.test(button.innerText || ''));
  if (!element) return { ok: false, reason: 'SETTINGS_CHIP_NOT_FOUND' };
  const rect = element.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
await clickAt(flow, chip);
await wait(350);
const control = await flow.evaluate(`((field, requested) => {
  const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')]
    .find((candidate) => /Hình ảnh|Image|Video/.test(candidate.innerText || ''));
  if (!menu) return { ok: false, reason: 'SETTINGS_MENU_NOT_FOUND' };
  const candidates = [...menu.querySelectorAll('[role="tab"], [role="menuitem"], button')];
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const element = candidates.find((candidate) => {
    const text = normalize(candidate.innerText);
    if (field === 'aspectRatio') return text === requested || text.endsWith(' ' + requested);
    if (field === 'durationSeconds') return text === requested + 's' || text.endsWith(' ' + requested + 's');
    if (field === 'targetResolution') return text.toLowerCase() === requested.toLowerCase() || text.toLowerCase().endsWith(' ' + requested.toLowerCase());
    return requested === 'VIDEO' ? /(?:^|\\s)Video$/i.test(text) : /(?:^|\\s)(?:Hình ảnh|Image)$/i.test(text);
  });
  if (!element) return { ok: false, reason: 'SETTING_VALUE_NOT_FOUND' };
  const rect = element.getBoundingClientRect();
  return rect.width && rect.height
    ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : { ok: false, reason: 'SETTING_VALUE_NOT_VISIBLE' };
})(${JSON.stringify(field)}, ${JSON.stringify(requested)})`);

const startedAt = performance.now();
const actionTimestamp = new Date().toISOString();
await clickAt(flow, control);
const labelByField = {
  aspectRatio: 'Aspect Ratio',
  durationSeconds: 'Duration',
  targetResolution: 'Resolution',
  mode: 'Flow Mode',
};
let studioApplied = null;
const deadline = performance.now() + 5_000;
while (performance.now() < deadline) {
  studioApplied = await studio.evaluate(`((label) => {
    const controls = [...document.querySelectorAll('.inspector select, .inspector input')];
    const control = controls.find((candidate) => (candidate.parentElement?.textContent || '').trim().startsWith(label));
    return control?.value ?? null;
  })(${JSON.stringify(labelByField[field])})`);
  if (studioApplied === studioExpected) break;
  await wait(20);
}
const latencyMs = Math.round(performance.now() - startedAt);
const flowApplied = await flow.evaluate(`((field) => {
  const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
    .find((button) => /Video ·|Nano Banana/.test(button.innerText || ''));
  if (!chip) return null;
  if (field === 'aspectRatio') {
    const icon = [...chip.querySelectorAll('i.google-symbols, .google-symbols')]
      .map((candidate) => (candidate.textContent || '').trim())
      .find((text) => /^crop_\\d+_\\d+$/.test(text));
    return icon?.replace(/^crop_/, '').replace('_', ':') || null;
  }
  if (field === 'durationSeconds') return chip.innerText.match(/\\b(\\d+)s\\b/i)?.[1] || null;
  if (field === 'targetResolution') return chip.innerText.match(/\\b(\\d{3,4}p)\\b/i)?.[1]?.toLowerCase() || null;
  return (chip.innerText || '').includes('Video ·') ? 'VIDEO' : 'IMAGE';
})(${JSON.stringify(field)})`);

flow.socket.close();
studio.socket.close();
const expectedFlow = field === 'targetResolution' ? requested.toLowerCase() : requested;
const result = {
  ok: flowApplied === expectedFlow && studioApplied === studioExpected,
  direction: 'GOOGLE_FLOW_TO_FLOWGRAPH',
  field,
  projectId,
  actionTimestamp,
  flowApplied,
  studioApplied,
  latencyMs,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(4);

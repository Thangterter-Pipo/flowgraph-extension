const field = process.argv[2];
const requested = process.argv[3];
if (!['aspectRatio', 'durationSeconds', 'targetResolution', 'mode'].includes(field) || !requested) {
  console.error('USAGE: node physical_setting_select.mjs <aspectRatio|durationSeconds|targetResolution|mode> <value>');
  process.exit(2);
}

const pages = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = pages.find((page) =>
  page.type === 'page'
  && /labs\.google\/fx\/(?:[a-z]{2}\/)?tools\/flow\/project\//.test(page.url || '')
);
if (!target) throw new Error('FLOW_PROJECT_NOT_FOUND');

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
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  const exception = response.result?.exceptionDetails;
  if (exception) throw new Error(exception.exception?.description || exception.text || 'Runtime.evaluate failed');
  return response.result?.result?.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function clickAt(point) {
  if (!point?.ok) throw new Error(point?.reason || 'SETTING_CONTROL_NOT_FOUND');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await wait(60);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
}

await call('Page.bringToFront');
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });

const chip = await evaluate(`(() => {
  const element = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
    .find((button) => /Video ·|Nano Banana/.test(button.innerText || ''));
  if (!element) return { ok: false, reason: 'SETTINGS_CHIP_NOT_FOUND' };
  const rect = element.getBoundingClientRect();
  return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);
await clickAt(chip);
await wait(500);

const control = await evaluate(`((field, requested) => {
  const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')]
    .find((candidate) => /Hình ảnh|Image|Video/.test(candidate.innerText || ''));
  if (!menu) return { ok: false, reason: 'SETTINGS_MENU_NOT_FOUND' };
  const controls = [...menu.querySelectorAll('[role="tab"], [role="menuitem"], button')];
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const element = controls.find((candidate) => {
    const text = normalize(candidate.innerText);
    if (field === 'aspectRatio') return text === requested || text.endsWith(' ' + requested);
    if (field === 'durationSeconds') return text === requested + 's' || text.endsWith(' ' + requested + 's');
    if (field === 'targetResolution') return text.toLowerCase() === requested.toLowerCase() || text.toLowerCase().endsWith(' ' + requested.toLowerCase());
    return requested === 'VIDEO'
      ? /(?:^|\\s)Video$/i.test(text)
      : /(?:^|\\s)(?:Hình ảnh|Image)$/i.test(text);
  });
  if (!element) return { ok: false, reason: 'SETTING_VALUE_NOT_FOUND', values: controls.map((candidate) => normalize(candidate.innerText)).filter(Boolean) };
  const rect = element.getBoundingClientRect();
  return rect.width && rect.height
    ? { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: normalize(element.innerText) }
    : { ok: false, reason: 'SETTING_VALUE_NOT_VISIBLE' };
})(${JSON.stringify(field)}, ${JSON.stringify(requested)})`);
console.log('CONTROL', JSON.stringify(control));
await clickAt(control);
await wait(700);

const applied = await evaluate(`((field) => {
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
socket.close();
const expected = field === 'targetResolution' ? requested.toLowerCase() : requested;
console.log(JSON.stringify({ ok: applied === expected, field, requested: expected, applied }));
if (applied !== expected) process.exit(4);

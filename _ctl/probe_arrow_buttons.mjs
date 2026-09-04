const list = await fetch('http://127.0.0.1:9224/json/list').then(r => r.json());
const flow = list.find(t => t.type === 'page' && t.url.includes('labs.google/fx'));
if (!flow) {
  console.log('NO_FLOW_TARGET');
  process.exit(1);
}

const ws = new WebSocket(flow.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

const expr = `(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.map((b, idx) => {
    const icons = Array.from(b.querySelectorAll('i.google-symbols, .google-symbols'))[0];
    const iconText = icons ? (icons.textContent || '').trim() : '';
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return {
      idx,
      iconText,
      text: (b.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2) },
      visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight && r.left >= 0 && r.left < window.innerWidth,
      disabled: b.disabled,
      ariaDisabled: b.getAttribute('aria-disabled'),
      opacity: cs.opacity,
      display: cs.display,
      visibility: cs.visibility,
      className: (b.className || '').toString().slice(0, 120)
    };
  }).filter(x => x.iconText === 'arrow_forward');
})()`;

const evalResult = await call('Runtime.evaluate', {
  expression: expr,
  returnByValue: true
});

console.log(JSON.stringify(evalResult.result.value, null, 2));
ws.close();
process.exit(0);

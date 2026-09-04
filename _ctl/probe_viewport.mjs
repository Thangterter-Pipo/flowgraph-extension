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
  const out = {};
  out.window = { innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY, dpr: window.devicePixelRatio };
  const btn = Array.from(document.querySelectorAll('button')).find(b => Array.from(b.querySelectorAll('i.google-symbols, .google-symbols')).some(c => (c.textContent||'').trim()==='arrow_forward'));
  if (btn) {
    const r = btn.getBoundingClientRect();
    out.btn = { x: r.left, y: r.top, w: r.width, h: r.height };
    out.btnAncestors = [];
    let el = btn.parentElement;
    let i = 0;
    while (el && i < 8) {
      const cs = getComputedStyle(el);
      out.btnAncestors.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,80), pos: cs.position, overflow: cs.overflow, rect: (()=>{const rr=el.getBoundingClientRect(); return {x:Math.round(rr.left),y:Math.round(rr.top),w:Math.round(rr.width),h:Math.round(rr.height)};})() });
      el = el.parentElement;
      i++;
    }
  }
  const ed = document.querySelector('[contenteditable="true"]');
  if (ed) { const er = ed.getBoundingClientRect(); out.editor = { x: er.left, y: er.top, w: er.width, h: er.height }; }
  return out;
})()`;

const evalResult = await call('Runtime.evaluate', {
  expression: expr,
  returnByValue: true
});

console.log(JSON.stringify(evalResult.result.value, null, 2));
ws.close();
process.exit(0);

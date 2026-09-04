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
  const ed = document.querySelector('[contenteditable="true"]');
  out.promptText = ed ? (ed.textContent || '').replace(/\\s+/g, ' ').trim() : null;
  bySymbols();
  function bySymbols() {
    const buttons = Array.from(document.querySelectorAll('button'));
    const gen = buttons.find((b) => {
      const icon = Array.from(b.querySelectorAll('i.google-symbols, .google-symbols')).find(c => (c.textContent||'').trim() === 'arrow_forward');
      return Boolean(icon);
    });
    out.generateButtonFound = Boolean(gen);
    out.generateButtonDisabled = gen ? (gen.disabled || gen.getAttribute('aria-disabled') === 'true') : null;
    if (gen) {
      const r = gen.getBoundingClientRect();
      out.generateButtonRect = { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width/2, cy: r.top + r.height/2 };
      out.generateButtonText = (gen.innerText || '').trim();
    }
  }
  const ids = new Set();
  document.querySelectorAll('img, video, a, [data-media-id]').forEach((el) => {
    const src = el.src || el.href || el.getAttribute('data-media-id') || el.currentSrc || '';
    const m = src.match(/getMediaUrlRedirect\\?name=([0-9a-f-]{36})/i) || src.match(/\\/media\\/([0-9a-f-]{36})/i);
    if (m && m[1]) ids.add(m[1]);
  });
  out.mediaIds = Array.from(ids);
  const loading = Array.from(document.querySelectorAll('[class*="loading"], [aria-busy="true"]'));
  out.busyCount = loading.length;
  out.title = document.title;
  return out;
})()`;

const evalResult = await call('Runtime.evaluate', {
  expression: expr,
  returnByValue: true
});

console.log(JSON.stringify(evalResult.result.value, null, 2));
ws.close();
process.exit(0);

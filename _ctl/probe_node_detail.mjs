const list = await fetch('http://127.0.0.1:9224/json/list').then(r => r.json());
const studio = list.find(t => t.type === 'page' && t.url.includes('studio.html'));
if (!studio) {
  console.log('NO_STUDIO_TARGET');
  process.exit(1);
}

const ws = new WebSocket(studio.webSocketDebuggerUrl);
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
  const p = document.querySelector('.execution-panel');
  if (!p) { out.missing = true; return out; }
  const cards = Array.from(p.querySelectorAll('.run-node-card'));
  out.cards = cards.map(c => ({
    title: c.querySelector('.run-node-title')?.innerText?.trim(),
    status: c.querySelector('.fg-badge')?.innerText?.trim(),
    meta: c.querySelector('.run-node-meta')?.innerText?.trim(),
    error: c.querySelector('.run-node-error, .error-text, [class*=error]')?.innerText?.trim() || null,
    html: c.outerHTML.slice(0, 2000)
  }));
  const head = p.querySelector('.execution-head .fg-badge')?.innerText?.trim();
  out.head = head;
  const summary = Array.from(p.querySelectorAll('.summary-row')).map(r => r.innerText.trim());
  out.summary = summary;
  return out;
})()`;

const evalResult = await call('Runtime.evaluate', {
  expression: expr,
  returnByValue: true
});

console.log(JSON.stringify(evalResult.result.value, null, 2));
ws.close();
process.exit(0);

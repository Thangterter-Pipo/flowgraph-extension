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

try {
  await call('Page.bringToFront');
  console.log('PAGE_BROUGHT_TO_FRONT');
} catch (e) {
  console.log('BRING_ERR', e.message);
}

// Wait for rendering to settle
await new Promise(r => setTimeout(r, 1500));

const evalResult = await call('Runtime.evaluate', {
  expression: `(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollY: window.scrollY, title: document.title }))()`,
  returnByValue: true
});
console.log('STATE', JSON.stringify(evalResult.result.value, null, 2));

ws.close();
process.exit(0);

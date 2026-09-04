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
  try { out.accountStatus = JSON.parse(localStorage.getItem('flowgraph.accountStatus')); } catch (e) { out.accountStatus = String(e); }
  try { out.flowStatus = JSON.parse(localStorage.getItem('flowgraph.flowStatus')); } catch (e) { out.flowStatus = String(e); }
  try { out.activeProject = JSON.parse(localStorage.getItem('flowgraph.activeProject')); } catch (e) { out.activeProject = String(e); }
  try { out.workflow = JSON.parse(localStorage.getItem('flowgraph.demo.workflow')); } catch (e) { out.workflow = String(e); }
  const bodyText = document.body.innerText || '';
  out.hasProjectRequired = bodyText.includes('PROJECT REQUIRED');
  out.hasAccountError = bodyText.includes('Account Error') || bodyText.includes('ACCOUNT ERROR');
  const runBtn = Array.from(document.querySelectorAll('button')).find(b => /run workflow/i.test(b.textContent || ''));
  out.runWorkflowText = runBtn ? (runBtn.textContent || '').trim() : null;
  out.runWorkflowDisabled = runBtn ? runBtn.disabled : null;
  return out;
})()`;

const evalResult = await call('Runtime.evaluate', {
  expression: expr,
  returnByValue: true
});

console.log(JSON.stringify(evalResult.result.value, null, 2));
ws.close();
process.exit(0);

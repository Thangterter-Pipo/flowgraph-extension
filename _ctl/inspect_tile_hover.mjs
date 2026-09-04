const pages = await fetch('http://127.0.0.1:9224/json/list').then((r) => r.json());
const page = pages.find((x) => (x.url || '').includes('labs.google/fx') && x.type === 'page');
if (!page) { console.error('FLOW_NOT_FOUND'); process.exit(2); }

let seq = 0;
const pending = new Map();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); const f = pending.get(m.id); if (f) { pending.delete(m.id); f(m); } });
function call(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, res);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 12000);
  });
}

const mediaId = 'f59a1f3a-06e9-4ba4-a900-98c0b135be85';
const p = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `((mediaId)=>{
    const img = Array.from(document.querySelectorAll('img')).find(i => (i.src || i.currentSrc || '').includes(mediaId));
    if (!img) return {ok:false, reason:'no-img'};
    const r = img.getBoundingClientRect();
    return {ok:true, x:r.left + r.width/2, y:r.top + r.height/2};
  })(${JSON.stringify(mediaId)})`,
});
const center = p.result?.result?.value;
console.log('CENTER', JSON.stringify(center));
if (center?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
  await new Promise((r) => setTimeout(r, 600));
}

const st = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `((mediaId)=>{
    const img = Array.from(document.querySelectorAll('img')).find(i => (i.src || i.currentSrc || '').includes(mediaId));
    if (!img) return {ok:false, reason:'no-img'};
    const container = img.closest('[role="button"]') || img.parentElement;
    const near = img.closest('div');
    // Collect every button or aria-labeled element within 3 ancestor levels
    const all = [];
    let cur = img;
    for (let i = 0; i < 6 && cur; i++) {
      const els = Array.from(cur.querySelectorAll('button, [role="button"], [aria-label], [data-testid]'))
        .map((el) => ({
          tag: el.tagName,
          role: el.getAttribute('role'),
          aria: el.getAttribute('aria-label'),
          text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
          icon: Array.from(el.querySelectorAll('i')).map((x) => (x.textContent || '').trim()).join('|'),
          testid: el.getAttribute('data-testid'),
          rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        }))
        .filter((e) => e.aria || e.text || e.role || e.icon || e.testid);
      all.push({ level: i, els });
      cur = cur.parentElement;
    }
    return { ok: true, containerTag: container?.tagName, all };
  })(${JSON.stringify(mediaId)})`,
});
console.log(JSON.stringify(st.result?.result?.value ?? st, null, 2));
ws.close();

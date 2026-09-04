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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
if (center?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
  await sleep(600);
}

// Click the "more_vert Khác" button at top-right of the tile.
const click = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `((mediaId)=>{
    const img = Array.from(document.querySelectorAll('img')).find(i => (i.src || i.currentSrc || '').includes(mediaId));
    if (!img) return {ok:false, reason:'no-img'};
    const container = img.closest('[role="button"]') || img.parentElement;
    const btn = Array.from(container.querySelectorAll('button')).find(b => (b.innerText || '').includes('Khác') || (b.textContent || '').includes('more_vert'));
    if (!btn) return {ok:false, reason:'no-more-btn'};
    const r = btn.getBoundingClientRect();
    return {ok:true, x:r.left + r.width/2, y:r.top + r.height/2, rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  })(${JSON.stringify(mediaId)})`,
});
const more = click.result?.result?.value;
console.log('MORE', JSON.stringify(more));
if (more?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: more.x, y: more.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: more.x, y: more.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: more.x, y: more.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(800);
}

const menu = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `(()=>{
    const menus = Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content]'));
    return menus.map((m) => ({
      role: m.getAttribute('role'),
      dataState: m.getAttribute('data-state'),
      text: (m.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 800),
      items: Array.from(m.querySelectorAll('[role="menuitem"], [role="button"], button')).map((it) => ({
        text: (it.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
        icon: Array.from(it.querySelectorAll('i')).map((x) => (x.textContent || '').trim()).join('|'),
        disabled: it.disabled || it.getAttribute('aria-disabled') === 'true',
      })),
    }));
  })()`,
});
console.log(JSON.stringify(menu.result?.result?.value ?? menu, null, 2));
ws.close();

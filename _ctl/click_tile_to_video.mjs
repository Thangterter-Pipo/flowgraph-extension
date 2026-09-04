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
const mediaId = process.argv[2] || 'f59a1f3a-06e9-4ba4-a900-98c0b135be85';

// 0) Close any lingering menu
await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `(()=>{
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
    return true;
  })()`,
});
await sleep(300);

// 1) Hover the tile center so action buttons appear
let p = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `((mediaId)=>{
    const img = Array.from(document.querySelectorAll('img')).find(i => (i.src || i.currentSrc || '').includes(mediaId));
    if (!img) return {ok:false, reason:'no-img'};
    const r = img.getBoundingClientRect();
    return {ok:true, x:r.left + r.width/2, y:r.top + r.height/2};
  })(${JSON.stringify(mediaId)})`,
});
let center = p.result?.result?.value;
if (center?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
  await sleep(500);
}

// 2) Click the tile more_vert (Khác) button
p = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `((mediaId)=>{
    const img = Array.from(document.querySelectorAll('img')).find(i => (i.src || i.currentSrc || '').includes(mediaId));
    if (!img) return {ok:false, reason:'no-img'};
    const container = img.closest('[role="button"]') || img.parentElement;
    const btn = Array.from(container.querySelectorAll('button')).find(b => (b.innerText || '').includes('Khác') || (b.textContent || '').includes('more_vert'));
    if (!btn) return {ok:false, reason:'no-more-btn'};
    const r = btn.getBoundingClientRect();
    return {ok:true, x:r.left + r.width/2, y:r.top + r.height/2};
  })(${JSON.stringify(mediaId)})`,
});
const more = p.result?.result?.value;
if (more?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: more.x, y: more.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: more.x, y: more.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: more.x, y: more.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(600);
}

// 3) Click the "motion_blur Tạo ảnh động" menuitem
p = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `(()=>{
    const menus = Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content]'));
    for (const menu of menus) {
      const item = Array.from(menu.querySelectorAll('[role="menuitem"], button')).find((it) => (it.innerText || '').includes('Tạo ảnh động') || (it.innerText || '').includes('motion_blur'));
      if (item) {
        const r = item.getBoundingClientRect();
        return {ok:true, x:r.left + r.width/2, y:r.top + r.height/2, text:(item.innerText||'').replace(/\\s+/g,' ').trim().slice(0,80)};
      }
    }
    return {ok:false, reason:'motion-item-not-found'};
  })()`,
});
const motion = p.result?.result?.value;
console.log('MOTION', JSON.stringify(motion));
if (motion?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: motion.x, y: motion.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: motion.x, y: motion.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: motion.x, y: motion.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1500);
}

// 4) Inspect resulting composer state
p = await call('Runtime.evaluate', {
  returnByValue: true,
  expression: `(()=>{
    const chip = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-haspopup')==='menu' && ((b.innerText||'').includes('Video ·') || (b.innerText||'').includes('Nano Banana')));
    const ed = document.querySelector('[contenteditable="true"]');
    const gen = Array.from(document.querySelectorAll('button')).find(b => Array.from(b.querySelectorAll('i.google-symbols,.google-symbols')).some(i => (i.textContent||'').trim()==='arrow_forward'));
    const img = document.querySelector('img[src*="getMediaUrlRedirect"]');
    const activeMedia = Array.from(document.querySelectorAll('img, video')).map(el => ({tag:el.tagName, src:(el.currentSrc||el.src||'').slice(0,140)})).filter(x=>x.src);
    return {
      url: location.href,
      chip: chip ? (chip.innerText||'').replace(/\\s+/g,' ').trim() : null,
      edText: (ed?.textContent||'').slice(0,120),
      genDisabled: gen ? (gen.disabled || gen.getAttribute('aria-disabled')==='true') : null,
      genText: gen ? (gen.innerText||'').replace(/\\s+/g,' ').trim() : null,
      imgSrc: img ? (img.currentSrc||img.src||'').slice(0,140) : null,
      activeMedia,
    };
  })()`,
});
console.log('STATE', JSON.stringify(p.result?.result?.value ?? p, null, 2));
ws.close();

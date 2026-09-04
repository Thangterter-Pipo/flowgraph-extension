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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 15000);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mediaId = process.argv[2] || 'f59a1f3a-06e9-4ba4-a900-98c0b135be85';

async function evalPage(expression) {
  const r = await call('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.text || 'eval error' };
  return r.result?.result?.value;
}

// Snapshot helper
const snapshot = () => evalPage(`(()=>{
  const chip = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-haspopup')==='menu' && ((b.innerText||'').includes('Video ·') || (b.innerText||'').includes('Nano Banana')));
  const ed = document.querySelector('[contenteditable="true"]');
  const gen = Array.from(document.querySelectorAll('button')).find(b => Array.from(b.querySelectorAll('i.google-symbols,.google-symbols')).some(i => (i.textContent||'').trim()==='arrow_forward'));
  const mediaRefs = Array.from(document.querySelectorAll('[data-media-id], [data-asset-id], [data-id]')).map(el=>({tag:el.tagName, dataMediaId:el.getAttribute('data-media-id'), dataAssetId:el.getAttribute('data-asset-id'), dataId:el.getAttribute('data-id'), src:(el.src||el.getAttribute('src')||'').slice(0,140)})).filter(x=>x.dataMediaId||x.dataAssetId||x.dataId||x.src);
  const boundThumb = Array.from(document.querySelectorAll('img')).filter(i=>(i.src||'').includes('getMediaUrlRedirect')||(i.currentSrc||'').includes('getMediaUrlRedirect')).map(i=>(i.currentSrc||i.src||'').slice(0,140));
  return {
    url: location.href,
    chip: chip ? (chip.innerText||'').replace(/\\s+/g,' ').trim() : null,
    edText: (ed?.textContent||'').slice(0,120),
    genDisabled: gen ? (gen.disabled || gen.getAttribute('aria-disabled')==='true') : null,
    genText: gen ? (gen.innerText||'').replace(/\\s+/g,' ').trim() : null,
    mediaRefs,
    boundThumb,
  };
})()`);

console.log('INITIAL', JSON.stringify(await snapshot(), null, 2));

// 0) close lingering menu
await evalPage(`(()=>{ document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true})); return true; })()`);
await sleep(300);

// 1) hover tile
let p = await evalPage(`((mediaId)=>{
  const img = Array.from(document.querySelectorAll('img')).find(i => (i.src || i.currentSrc || '').includes(mediaId));
  if (!img) return {ok:false, reason:'no-img'};
  const r = img.getBoundingClientRect();
  return {ok:true, x:r.left + r.width/2, y:r.top + r.height/2};
})(${JSON.stringify(mediaId)})`);
if (p?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await sleep(500);
}

// 2) hover more_vert
p = await evalPage(`((mediaId)=>{
  const img = Array.from(document.querySelectorAll('img')).find(i => (i.src || i.currentSrc || '').includes(mediaId));
  if (!img) return {ok:false, reason:'no-img'};
  const container = img.closest('[role="button"]') || img.parentElement;
  const btn = Array.from(container.querySelectorAll('button')).find(b => (b.innerText||'').includes('Khác') || (b.textContent||'').includes('more_vert'));
  if (!btn) return {ok:false, reason:'no-more-btn'};
  const r = btn.getBoundingClientRect();
  return {ok:true, x:r.left + r.width/2, y:r.top + r.height/2};
})(${JSON.stringify(mediaId)})`);
if (p?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(600);
}

// 3) click motion_blur menuitem via physical
p = await evalPage(`(()=>{
  const menus = Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content]'));
  for (const menu of menus) {
    const item = Array.from(menu.querySelectorAll('[role="menuitem"], button')).find((it) => (it.innerText||'').includes('Tạo ảnh động') || (it.innerText||'').includes('motion_blur'));
    if (item) { const r = item.getBoundingClientRect(); return {ok:true, x:r.left + r.width/2, y:r.top + r.height/2, text:(item.innerText||'').replace(/\\s+/g,' ').trim().slice(0,80)}; }
  }
  return {ok:false, reason:'motion-item-not-found'};
})()`);
console.log('MOTION', JSON.stringify(p));
if (p?.ok) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1500);
}

console.log('AFTER_BIND', JSON.stringify(await snapshot(), null, 2));

// 4) Type a prompt into the editor
const prompt = 'A cinematic slow motion shot of the sports car driving through rain, cinematic lighting.';
await evalPage(`(()=>{
  const ed = document.querySelector('[contenteditable="true"]');
  if (ed) { ed.focus(); }
  return true;
})()`);
await call('Input.insertText', { text: prompt });
await sleep(1000);

console.log('AFTER_PROMPT', JSON.stringify(await snapshot(), null, 2));

// 5) Check the menu / attached media reference more thoroughly
p = await evalPage(`(()=>{
  const body = (document.body.innerText||'');
  // search for any element containing the mediaId as an attribute or img src near composer
  const refs = [];
  document.querySelectorAll('*').forEach((el) => {
    const s = (el.getAttribute && (el.getAttribute('data-media-id') || el.getAttribute('data-src') || el.getAttribute('src') || el.getAttribute('href'))) || '';
    if (s && s.includes('f59a1f3a-06e9-4ba4-a900-98c0b135be85')) {
      const r = el.getBoundingClientRect();
      if (r.top > 700) refs.push({tag:el.tagName, attr:el.getAttribute('data-media-id')||el.getAttribute('data-src'), src:(el.getAttribute('src')||el.getAttribute('href')||'').slice(0,120), rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}});
    }
  });
  return {refs, hasMotionPrompt: /Tạo ảnh động|ảnh động/.test(body)};
})()`);
console.log('REFCHECK', JSON.stringify(p, null, 2));

await call('Page.captureScreenshot', { format: 'png' }).catch(()=>{});
ws.close();

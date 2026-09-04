const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const page = pages.find(x=>(x.url||'').includes('labs.google/fx') && x.type==='page');
if(!page){console.error('FLOW_NOT_FOUND');process.exit(2)}
let seq=0;const pending=new Map();
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const f=pending.get(m.id);if(f){pending.delete(m.id);f(m)}});
function call(method,params={}){const id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{pending.set(id,res);setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method))}},30000)})}
const mediaId = process.argv[2] || '883af4be-4a44-41cd-87fe-62e4cb10ed0c';
// CORRECTED async IIFE, same body as service-worker but capturing reason
const expr = `(async (mediaId) => {
  try {
    const candidates = Array.from(document.querySelectorAll('img, video, a, [data-media-id]'));
    const matchesMediaId = (el) => {
      const values = [ el.getAttribute?.('data-media-id'), el.getAttribute?.('src'), el.getAttribute?.('href'), el.currentSrc, el.src, el.href ].filter(Boolean).map(String);
      return values.some((value) => value.includes(mediaId));
    };
    const mediaEl = candidates.find(matchesMediaId);
    if (!mediaEl) return { ok: false, reason: 'source-media-not-found' };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el) => { ['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach((type) => { const C = type.startsWith('pointer') ? PointerEvent : MouseEvent; el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 })); }); };
    const tile = mediaEl.closest?.('[role="button"]') || mediaEl.parentElement;
    if (!tile) return { ok: false, reason: 'source-media-not-clickable' };
    tile.scrollIntoView?.({ block: 'center', inline: 'center' });
    fire(tile);
    await sleep(400);
    fire(tile);
    await sleep(400);
    const container = (tile.closest?.('[role="button"]') ?? tile).parentElement;
    const moreBtn = Array.from(container?.querySelectorAll('button') ?? []).find((b) => (b.innerText || '').includes('Khác') || (b.textContent || '').includes('more_vert'));
    if (!moreBtn) return { ok: false, reason: 'tile-menu-button-not-found', tileTag: tile.tagName, tileRole: tile.getAttribute('role'), tileHref: tile.getAttribute?.('href'), containerTag: container?.tagName, url: location.href };
    fire(moreBtn);
    await sleep(600);
    let motionItem = null;
    for (const menu of Array.from(document.querySelectorAll('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content]'))) {
      motionItem = Array.from(menu.querySelectorAll('[role="menuitem"], button')).find((it) => (it.innerText || '').includes('Tạo ảnh động') || (it.innerText || '').includes('motion_blur'));
      if (motionItem) break;
    }
    if (!motionItem) return { ok: false, reason: 'tile-motion-item-not-found', url: location.href };
    fire(motionItem);
    await sleep(900);
    return { ok: true, url: location.href, tileTag: tile.tagName, tileRole: tile.getAttribute('role') };
  } catch (err) { return { ok: false, reason: 'EXCEPTION', message: String((err && (err.stack||err)) || err), url: location.href }; }
})(${JSON.stringify(mediaId)})`;
const r = await call('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
if(r.exceptionDetails){console.log('TOP_EXC',JSON.stringify(r.exceptionDetails,null,2));}
else console.log('RESULT',JSON.stringify(r.result?.result?.value,null,2));
ws.close();


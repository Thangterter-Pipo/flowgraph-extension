const [,, target] = process.argv; // target: image | video
const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
function cdp(expr){
  return new Promise(async (resolve)=>{
    const ws=new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
    const id=1;
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
    const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),12000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===id){clearTimeout(to);res(x)}})});
    ws.close();
    resolve(m.result?.result?.value);
  });
}

const readState=`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  if(!chip) return {ok:false,state:'no-chip'};
  const text=(chip.innerText||'').replace(/\\s+/g,' ').trim();
  return {ok:true,isVideo:text.includes('Video ·'),text};
})()`;
const before=await cdp(readState);
console.log('BEFORE',JSON.stringify(before));

const wantVideo = target === 'video';

// Ensure menu open
await cdp(`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  if(!chip) return false;
  if(document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]')) return true;
  ["pointerover","pointerenter","pointermove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(type=>{
    const C = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    chip.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));
  });
  return true;
})()`);
await new Promise(r=>setTimeout(r,800));

// Click the target tab
const clicked=await cdp(`(()=>{
  const tabs=Array.from(document.querySelectorAll('[role="tab"]'));
  const tab=tabs.find(t=>{
    const txt=(t.innerText||'').toLowerCase();
    return ${wantVideo ? "txt.includes('video')" : "txt.includes('hình ảnh') || txt.includes('image')"};
  });
  if(!tab) return {ok:false,tabs:tabs.map(t=>(t.innerText||'').trim().slice(0,40))};
  ["pointerover","pointerenter","pointermove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(type=>{
    const C = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    tab.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));
  });
  return {ok:true,sel:tab.getAttribute('aria-selected'),txt:(tab.innerText||'').trim()};
})()`);
console.log('CLICK',JSON.stringify(clicked));
await new Promise(r=>setTimeout(r,800));

// Close menu via Escape
await cdp(`(()=>{
  const menu=document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]');
  if(menu){ menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true})); }
  return true;
})()`);
await new Promise(r=>setTimeout(r,300));
// also physical esc
await cdp(`(()=>{ document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true})); return true; })()`);
await new Promise(r=>setTimeout(r,300));

const after=await cdp(readState);
console.log('AFTER',JSON.stringify(after));

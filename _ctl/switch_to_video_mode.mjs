const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
function cdp(expr){
  return new Promise(async (resolve)=>{
    const ws=new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
    const id=Math.floor(Math.random()*1e6)+1;
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
    const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===id){clearTimeout(to);res(x)}})});
    ws.close();
    resolve(m.result?.result?.value);
  });
}

const readState=`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  if(!chip) return {ok:false,state:'no-chip'};
  const text=(chip.innerText||'').replace(/\\s+/g,' ').trim();
  const isVideo=text.includes('Video ·');
  return {ok:true,isVideo,text};
})()`;
const before=await cdp(readState);
console.log('BEFORE',JSON.stringify(before));

// Ensure menu is open
let opened=await cdp(`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  if(!chip) return false;
  const existing=document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]');
  if(existing) return true;
  ["pointerover","pointerenter","pointermove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(type=>{
    const C = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    chip.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));
  });
  return true;
})()`);
await new Promise(r=>setTimeout(r,800));

const clicked=await cdp(`(()=>{
  if(!window.__fgsv_video_clicked){
    const tabs=Array.from(document.querySelectorAll('[role="tab"]'));
    const videoTab=tabs.find(t=>(t.innerText||'').includes('Video'));
    if(videoTab){
      ["pointerover","pointerenter","pointermove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(type=>{
        const C = type.startsWith('pointer') ? PointerEvent : MouseEvent;
        videoTab.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));
      });
      window.__fgsv_video_clicked=true;
      return true;
    }
    return false;
  }
  return true;
})()`);
await new Promise(r=>setTimeout(r,800));

// close menu
await cdp(`(()=>{
  const open=document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"]');
  if(open){ open.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true})); }
  return true;
})()`);
await new Promise(r=>setTimeout(r,300));

const after=await cdp(readState);
console.log('AFTER',JSON.stringify(after));
delete window.__fgsv_video_clicked;

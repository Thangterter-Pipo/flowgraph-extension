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
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Ensure video mode
await cdp(`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  if(!chip)return false;
  if((chip.innerText||'').includes('Video ·'))return true;
  const ev=el=>['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(type=>{const C=type.startsWith('pointer')?PointerEvent:MouseEvent;el.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));});
  ev(chip);return true;
})()`);
await sleep(800);
// Click video tab
await cdp(`(()=>{
  const tab=Array.from(document.querySelectorAll('[role="tab"]')).find(t=>(t.innerText||'').toLowerCase().includes('video'));
  if(!tab)return false;
  const ev=el=>['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(type=>{const C=type.startsWith('pointer')?PointerEvent:MouseEvent;el.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));});
  ev(tab);return true;
})()`);
await sleep(800);
// Now open menu again and click Components tab
await cdp(`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&(b.innerText||'').includes('Video ·'));
  if(!chip)return false;
  const ev=el=>['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(type=>{const C=type.startsWith('pointer')?PointerEvent:MouseEvent;el.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));});
  ev(chip);return true;
})()`);
await sleep(800);
// Inspect menu tabs and click "Thành phần"
const click=await cdp(`(()=>{
  const tabs=Array.from(document.querySelectorAll('[role="tab"]')).map(t=>({text:(t.innerText||'').replace(/\\s+/g,' ').trim().slice(0,50),selected:t.getAttribute('aria-selected')}));
  const comp=Array.from(document.querySelectorAll('[role="tab"]')).find(t=>(t.innerText||'').toLowerCase().includes('thành phần')||(t.innerText||'').toLowerCase().includes('component'));
  if(comp){
    const ev=el=>['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(type=>{const C=type.startsWith('pointer')?PointerEvent:MouseEvent;el.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));});
    ev(comp);
  }
  return {tabs,found:!!comp};
})()`);
console.log('CLICK',JSON.stringify(click));
await sleep(1000);
const menu=await cdp(`(()=>{
  const menu=document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [data-radix-menu-content]');
  const body=document.body.innerText||'';
  // Find any media/assets picker region
  const mediaImgs=Array.from(document.querySelectorAll('img')).map(i=>({src:(i.currentSrc||i.src||'').slice(0,140),alt:i.alt})).filter(x=>x.src);
  const dialogs=Array.from(document.querySelectorAll('[role="dialog"],[role="menu"],[data-radix-menu-content]')).map(d=>({role:d.getAttribute('role'),text:(d.innerText||'').replace(/\\s+/g,' ').trim().slice(0,600),dataState:d.getAttribute('data-state')}));
  return {menuText:(menu?.innerText||'').replace(/\\s+/g,' ').trim().slice(0,900),dialogs,mediaImgs:mediaImgs.slice(0,20)};
})()`);
console.log('MENU',JSON.stringify(menu,null,2));

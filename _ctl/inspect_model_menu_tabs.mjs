const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  if(!chip) return {ok:false,reason:'no-chip'};
  const r=chip.getBoundingClientRect();
  ["pointerover","pointerenter","pointermove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(type=>{
    const C = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    chip.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));
  });
  return {ok:true,text:(chip.innerText||'').replace(/\\s+/g,' ').trim(),x:r.x+Math.round(r.width/2),y:r.y+Math.round(r.height/2)};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();
console.log('OPEN',JSON.stringify(m.result?.result?.value??m));
await new Promise(r=>setTimeout(r,1000));
const ws2=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws2.addEventListener('open',res,{once:true});ws2.addEventListener('error',rej,{once:true})});
const expr2=`(()=>{
  const tabs=Array.from(document.querySelectorAll('[role="tab"]')).map(el=>({text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60),selected:el.getAttribute('aria-selected'),disabled:el.getAttribute('aria-disabled'),mid:el.getAttribute('data-state')}));
  const menu=document.querySelector('[role="menu"][data-state="open"], [data-radix-menu-content], [role="dialog"][data-state="open"]');
  const menuText=menu?.innerText?.replace(/\\s+/g,' ').trim().slice(0,1500)||'';
  const items=Array.from(document.querySelectorAll('[role="menuitem"], [role="option"]')).map(el=>({text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60),checked:el.getAttribute('aria-checked'),selected:el.getAttribute('aria-selected'),dataState:el.getAttribute('data-state')}));
  return {tabs,menuText,items};
})()`;
ws2.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr2,returnByValue:true,awaitPromise:true}}));
const m2=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws2.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws2.close();
console.log('MENU',JSON.stringify(m2.result?.result?.value??m2,null,2));

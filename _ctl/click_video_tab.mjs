const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const tabs=Array.from(document.querySelectorAll('button[role="tab"]'));
  const videoTab=tabs.find(b=>(b.innerText||'').includes('Video'));
  if(!videoTab) return {ok:false,reason:'no-video-tab',tabs:tabs.map(t=>(t.innerText||'').trim())};
  ["pointerover","pointerenter","pointermove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(type=>{
    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    videoTab.dispatchEvent(new EventCtor(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));
  });
  return {ok:true,selected:videoTab.getAttribute('aria-selected')};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log('CLICK',JSON.stringify(m.result?.result?.value??m));
await new Promise(r=>setTimeout(r,1000));
const ws2=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws2.addEventListener('open',res,{once:true});ws2.addEventListener('error',rej,{once:true})});
const expr2=`(()=>{
  const menu=document.querySelector('[role="menu"][data-state="open"]');
  const menuText=menu?.innerText||'';
  return {menuText:menuText.replace(/\\s+/g,' ').trim().slice(0,800), open:!!menu};
})()`;
ws2.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr2,returnByValue:true,awaitPromise:true}}));
const m2=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws2.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws2.close();console.log('MENU',JSON.stringify(m2.result?.result?.value??m2,null,2));

const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const ed=document.querySelector('[contenteditable="true"]');
  // model chip now "Video · 720p · 4s". Expand it.
  const modelBtn=Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').includes('Video ·'));
  if(modelBtn){
    const r=modelBtn.getBoundingClientRect();
    ["pointerover","pointerdown","mousedown","pointerup","mouseup","click"].forEach(type=>{
      const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      modelBtn.dispatchEvent(new EventCtor(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));
    });
    return {ok:true,opened:true};
  }
  return {ok:false,modelBtnFound:false};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log('OPEN',JSON.stringify(m.result?.result?.value??m));
await new Promise(r=>setTimeout(r,800));
const ws2=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws2.addEventListener('open',res,{once:true});ws2.addEventListener('error',rej,{once:true})});
const expr2=`(()=>{
  const menu=document.querySelector('[role="menu"][data-state="open"]');
  const items=Array.from(document.querySelectorAll('[role="menuitem"],[role="tab"],[role="option"],[data-radix-collection-item]')).map(el=>({text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,70),aria:el.getAttribute('aria-label'),role:el.getAttribute('role'),dataState:el.getAttribute('data-state')})).filter(x=>x.text||x.aria);
  return {menuText:menu?.innerText?.replace(/\\s+/g,' ').trim().slice(0,900),items};
})()`;
ws2.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr2,returnByValue:true,awaitPromise:true}}));
const m2=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws2.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws2.close();console.log('MENU',JSON.stringify(m2.result?.result?.value??m2,null,2));

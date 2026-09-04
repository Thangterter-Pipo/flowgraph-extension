const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const btn=Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').includes('Nano Banana'));
  if(!btn) return {ok:false,reason:'no-model-chip'};
  const rect=btn.getBoundingClientRect();
  // Dispatch pointer/mouse events via CDP to open the Radix menu
  ["pointerover","pointerenter","pointermove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(type=>{
    const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    btn.dispatchEvent(new EventCtor(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));
  });
  return {ok:true,rect:{x:rect.x,y:rect.y,w:rect.width,h:rect.height}};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log(JSON.stringify(m.result?.result?.value??m,null,2));
// Wait for menu to open, then inspect
await new Promise(r=>setTimeout(r,800));
const ws2=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws2.addEventListener('open',res,{once:true});ws2.addEventListener('error',rej,{once:true})});
const expr2=`(()=>{
  const menus=Array.from(document.querySelectorAll('[role="menu"],[role="listbox"],[data-radix-menu-content],div[data-state="open"]')).map(el=>({tag:el.tagName,role:el.getAttribute('role'),state:el.getAttribute('data-state'),text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,600),outer:el.outerHTML.slice(0,1500)}));
  const menuItems=Array.from(document.querySelectorAll('[role="menuitem"],[role="option"],[data-radix-collection-item]')).map(el=>({text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,80),aria:el.getAttribute('aria-label'),cls:(el.className||'').toString().slice(0,60)})).filter(x=>x.text||x.aria);
  return {menus,menuItems};
})()`;
ws2.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr2,returnByValue:true,awaitPromise:true}}));
const m2=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws2.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws2.close();console.log('MENU',JSON.stringify(m2.result?.result?.value??m2,null,2));

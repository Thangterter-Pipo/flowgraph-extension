const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const img=document.querySelector('img[src*="getMediaUrlRedirect"]');
  if(!img) return {ok:false,reason:'no-image'};
  const tile=img.closest('[role="button"]')||img.parentElement;
  const tileOuter=tile?.outerHTML||'';
  // Find any context menu / action popover currently in DOM
  const menuEls=Array.from(document.querySelectorAll('[role="menu"],[role="listbox"],[data-testid*="menu"],[class*="menu"],[class*="popover"],[class*="context"]')).map(el=>({tag:el.tagName,role:el.getAttribute('role'),text:(el.innerText||'').slice(0,200),cls:(el.className||'').toString().slice(0,80)})).slice(0,10);
  // Find clickable elements with "animate", "video", "i2v", "chuyển", "tạo video" text
  const actionNodes=Array.from(document.querySelectorAll('button,[role="button"],[tabindex]')).map((el,i)=>({i,text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60),aria:el.getAttribute?.('aria-label')})).filter(x=>/video|animate|chuy|tạo|i2v|motion|động|anim/i.test(x.text||x.aria||''));
  return {ok:true,tileTag:tile?.tagName,tileOuter:tileOuter.slice(0,1500),menuEls,actionNodes};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log(JSON.stringify(m.result?.result?.value??m,null,2));

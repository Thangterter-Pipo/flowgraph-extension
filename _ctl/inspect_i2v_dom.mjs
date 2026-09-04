const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const img=document.querySelector('img[src*="getMediaUrlRedirect"]');
  if(!img) return {ok:false,reason:'no-image'};
  let clickable=img.closest('button,[role="button"],[data-testid],[tabindex]')||img.parentElement;
  if(!clickable) return {ok:false,reason:'no-clickable'};
  const r=clickable.getBoundingClientRect();
  const info={tag:clickable.tagName,role:clickable.getAttribute('role'),ariaDisabled:clickable.getAttribute('aria-disabled'),text:(clickable.innerText||'').slice(0,80),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  clickable.click();
  return {ok:true,clicked:info};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log(JSON.stringify(m.result?.result?.value??m,null,2));

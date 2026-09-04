const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const out=[];
  document.querySelectorAll('img, video, a, [data-media-id]').forEach((el)=>{
    const values=[el.getAttribute?.('data-media-id'),el.getAttribute?.('src'),el.getAttribute?.('href'),el.currentSrc,el.src,el.href].filter(Boolean).map(String);
    const mediaId=(values.map(v=>v.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)).find(Boolean)?.[0])||null;
    const role=el.closest?.('[role="button"]');
    const a=el.closest?.('a');
    const btn=el.closest?.('button');
    if(!mediaId) return;
    out.push({
      tag:el.tagName.toLowerCase(),
      mediaId,
      alt:el.getAttribute('alt'),
      role:role?.getAttribute('role')||null,
      roleHref:role?.getAttribute?.('href')||null,
      btnText:(btn?.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60),
      aHref:a?.getAttribute('href')||null,
      rect:(()=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})()
    });
  });
  return out;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();
console.log(JSON.stringify(m.result?.result?.value??m,null,2));

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
const out=await cdp(`(()=>{
  // Dump all elements visible in the composer band (y around 760-940)
  const els=Array.from(document.querySelectorAll('*')).filter(el=>{
    const r=el.getBoundingClientRect();
    const tag=el.tagName;
    if(!['BUTTON','INPUT','DIV','SPAN'].includes(tag))return false;
    if(r.top<720||r.top>960||r.width<8||r.height<8)return false;
    if(el.children.length>0&&el.children.length<40)return false;
    return true;
  }).slice(0,80);
  const rows=els.map(el=>{
    const r=el.getBoundingClientRect();
    return {tag:el.tagName,role:el.getAttribute('role'),cls:(el.className||'').toString().slice(0,50),text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,50),aria:el.getAttribute('aria-label'),testid:el.getAttribute('data-testid'),dataState:el.getAttribute('data-state'),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  });
  return {rows};
})()`);
console.log(JSON.stringify(out,null,2));

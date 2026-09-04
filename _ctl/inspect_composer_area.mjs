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
  const ed=document.querySelector('[contenteditable="true"]');
  if(!ed)return {ok:false,reason:'no-editor'};
  // Find a chrome containing the editor, then dump up to the main composer container
  let container=ed;
  for(let i=0;i<12;i++){
    if(container.parentElement) container=container.parentElement;
  }
  const rect=ed.getBoundingClientRect();
  const html=(container?.outerHTML||'').slice(0,6000);
  // Also find the bottom composer container by looking for contenteditable near bottom
  const mediaSlots=Array.from(document.querySelectorAll('[data-testid], [aria-label]')).filter(el=>{const r=el.getBoundingClientRect();return r.top>400&&r.top<900;}).map(el=>({tag:el.tagName,aria:el.getAttribute('aria-label'),testid:el.getAttribute('data-testid'),text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60)}));
  return {ok:true,editorRect:{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)},html,mediaSlots:mediaSlots.slice(0,40)};
})()`);
console.log(JSON.stringify(out,null,2));

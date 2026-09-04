const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const btn=Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').includes('Nano Banana'));
  if(!btn) return {ok:false,reason:'no-model-chip'};
  const outer=btn.outerHTML;
  const rect=btn.getBoundingClientRect();
  // Find sibling/parent structures that reveal the model picker
  const parent=btn.parentElement;
  const parentOuter=parent?.outerHTML||'';
  return {ok:true,outer:outer.slice(0,1200),parentOuter:parentOuter.slice(0,1600),rect:{x:Math.round(rect.x),y:Math.round(rect.y),w:Math.round(rect.width),h:Math.round(rect.height)},btnText:(btn.innerText||'').replace(/\\s+/g,' ').trim()};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log(JSON.stringify(m.result?.result?.value??m,null,2));

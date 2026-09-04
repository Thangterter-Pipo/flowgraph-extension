const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const page = pages.find(x=>(x.url||'').includes('labs.google/fx') && x.type==='page');
if(!page){console.error('FLOW_NOT_FOUND');process.exit(2)}
let seq=0;const pending=new Map();
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const f=pending.get(m.id);if(f){pending.delete(m.id);f(m)}});
function call(method,params={}){const id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{pending.set(id,res);setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method))}},20000)})}
const mediaId = process.argv[2] || '883af4be-4a44-41cd-87fe-62e4cb10ed0c';
const expr = `((mediaId) => {
  const img = Array.from(document.querySelectorAll('img')).find(i => (i.src || i.currentSrc || '').includes(mediaId));
  if (!img) return {ok:false,reason:'no-img'};
  // walk up chain, record role/tag/class and whether it contains a more_vert button
  const chain = [];
  let el = img;
  for (let i=0;i<10 && el;i++){
    const hasMore = Array.from(el.querySelectorAll('button')).some(b=>(b.innerText||'').includes('Khác')||(b.textContent||'').includes('more_vert'));
    const hasImg = el.querySelector && el.querySelector('img') === img;
    chain.push({lv:i, tag:el.tagName, role:el.getAttribute('role'), cls:(el.className||'').toString().slice(0,60), hasMore, directImg:hasImg, childCount:el.children?.length});
    el = el.parentElement;
  }
  return {ok:true, chain, imgRole:img.getAttribute('role'), imgParentTag:img.parentElement?.tagName, parentChildCount:img.parentElement?.children?.length};
})(${JSON.stringify(mediaId)})`;
const r = await call('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
console.log(JSON.stringify(r.result?.result?.value ?? r,null,2));
ws.close();

const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx') && (x.url||'').includes('/tools/flow'));
if (!t) { console.error('FLOW_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(() => {
  const out = [];
  document.querySelectorAll('img').forEach((el, i) => {
    out.push({
      i,
      src: (el.getAttribute('src')||'').slice(0,120),
      currentSrc: (el.currentSrc||'').slice(0,160),
      complete: el.complete,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      w: el.width, h: el.height,
      dataMediaId: el.getAttribute('data-media-id'),
    });
  });
  return out.slice(0, 20);
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),15000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

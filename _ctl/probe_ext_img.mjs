const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('chrome-extension://') && (x.url||'').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const mediaId = 'fa406712-fa78-4154-8112-cb66c2909a29';
const expression = `(async () => {
  const url = 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name='+encodeURIComponent('${mediaId}');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok:false, reason:'timeout' }), 12000);
    img.onload = () => { clearTimeout(timer); resolve({ ok:true, w:img.naturalWidth, h:img.naturalHeight, src:img.currentSrc }); };
    img.onerror = () => { clearTimeout(timer); resolve({ ok:false, reason:'error' }); };
    img.src = url;
  });
  return result;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),15000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

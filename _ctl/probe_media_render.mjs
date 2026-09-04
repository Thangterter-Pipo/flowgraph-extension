const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('chrome-extension://') && (x.url||'').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(async () => {
  const results = [];
  const imgs = Array.from(document.querySelectorAll('.flow-node .node-result-media img'));
  const vids = Array.from(document.querySelectorAll('.flow-node .node-result-media video'));
  for (const img of imgs) {
    const src = img.getAttribute('src');
    const done = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok:false, reason:'timeout' }), 12000);
      if (img.complete) { clearTimeout(timer); resolve({ ok: img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight }); return; }
      img.onload = () => { clearTimeout(timer); resolve({ ok:true, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(timer); resolve({ ok:false, reason:'error' }); };
    });
    results.push({ kind:'img', src, ...done });
  }
  for (const v of vids) {
    const src = v.getAttribute('src');
    const done = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok:false, reason:'timeout' }), 12000);
      v.onloadeddata = () => { clearTimeout(timer); resolve({ ok:true, videoWidth: v.videoWidth, videoHeight: v.videoHeight }); };
      v.onerror = () => { clearTimeout(timer); resolve({ ok:false, reason:'error' }); };
    });
    results.push({ kind:'video', src, ...done });
  }
  return results;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),30000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

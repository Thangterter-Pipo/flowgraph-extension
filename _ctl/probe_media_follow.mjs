const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx') && (x.url||'').includes('/tools/flow'));
if (!t) { console.error('FLOW_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const mediaId = 'fa406712-fa78-4154-8112-cb66c2909a29';
const expression = `(async () => {
  const r = await fetch('https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name='+encodeURIComponent('${mediaId}'), {
    method:'GET', credentials:'include', redirect:'follow'
  }).catch(e => ({ caught: String(e) }));
  if (r.caught) return { caught: r.caught };
  let loc = null; let ctype = null;
  try { loc = r.headers.get('location'); } catch(e) { loc = 'ERR:'+e.message; }
  try { ctype = r.headers.get('content-type'); } catch(e) { ctype = 'ERR:'+e.message; }
  const buf = await r.arrayBuffer().catch(()=>null);
  return {
    status: r.status, statusText: r.statusText, type: r.type,
    finalUrl: r.url, location: loc, contentType: ctype, bytes: buf ? buf.byteLength : null,
  };
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),30000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('chrome-extension://') && (x.url||'').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(() => {
  const raw = localStorage.getItem('flowgraph.demo.workflow')||'null';
  const wf = JSON.parse(raw);
  if (!wf) return { none: true };
  const nodes = (wf.nodes||[]).map(n => ({ id: n.id, kind: n.data?.kind, status: n.data?.status, result: n.data?.result, configResultUrl: n.data?.config?.resultUrl, configPreviewUrl: n.data?.config?.previewUrl, configOutputUrl: n.data?.config?.outputUrl }));
  return { schema: wf.schemaVersion, runtimeResults: wf.runtimeResults, nodes };
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),15000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

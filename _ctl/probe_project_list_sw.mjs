const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const sw = pages.find(x => x.type === 'service_worker' && (x.url||'').includes('background/service-worker'));
if (!sw) { console.error('SW_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(sw.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expr = `(async()=>{
  // Query the Flow tab page directly from the extension's own fetch context.
  const inputParam = encodeURIComponent(JSON.stringify({ json: { pageSize: 20, toolName: 'PINHOLE' } }));
  const res = await fetch('https://labs.google/fx/api/trpc/project.searchUserProjects?input=' + inputParam, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 500) };
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m = await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),15000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});
ws.close();
console.log(JSON.stringify(m.result?.result?.value ?? m.result ?? m, null, 2));

const [portRaw, needle, ...exprParts] = process.argv.slice(2);
const port = Number(portRaw);
const expr = exprParts.join(' ');
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
const target = pages.find(x => (x.url||'').includes(needle) && (x.type==='page' || x.type==='service_worker'));
if (!target) { console.error('TARGET_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
const id=1;
ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const result = await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('CDP_TIMEOUT')),10000);
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(timer);resolve(m);}}, {once:false});
});
ws.close();
console.log(JSON.stringify(result.result?.result?.value ?? result.result?.result?.description ?? result, null, 2));

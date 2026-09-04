const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const page = pages.find(x=>(x.url||'').includes('labs.google/fx') && x.type==='page');
if(!page){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const mediaId='883af4be-4a44-41cd-87fe-62e4cb10ed0c';
// A minimal sync IIFE with await inside (NOT async) — mirrors service-worker shape
const expr = `(() => { const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); await sleep(400); return {ok:true}; })()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});
console.log('RAW', JSON.stringify(m,null,2));
ws.close();

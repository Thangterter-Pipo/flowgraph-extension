const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expr = `(async()=>{
  return await new Promise((resolve)=>{
    chrome.runtime.sendMessage({type:'FLOWGRAPH_ACCOUNT_STATUS',requestId:'t1'},(resp)=>{
      resolve({ resp, lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : null });
    });
  });
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m = await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),12000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});
ws.close();
console.log(JSON.stringify(m.result?.result?.value ?? m.result ?? m, null, 2));

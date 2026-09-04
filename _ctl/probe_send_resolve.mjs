const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('chrome-extension://') && (x.url||'').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(async () => {
  const mediaId = 'fa406712-fa78-4154-8112-cb66c2909a29';
  const tabs = await chrome.tabs.query({});
  const flowTab = tabs.find(tb => (tb.url||'').includes('labs.google/fx') && (tb.url||'').includes('/tools/flow'));
  if (!flowTab) return { ok:false, code:'NO_FLOW_TAB', tabs:tabs.map(t=>({id:t.id,url:t.url})) };
  const reply = await new Promise((resolve) => {
    chrome.tabs.sendMessage(flowTab.id, { type:'RESOLVE_MEDIA_URL', mediaId }, (res) => {
      if (chrome.runtime.lastError) resolve({ ok:false, error:chrome.runtime.lastError.message });
      else resolve(res);
    });
  });
  return { tab: {id:flowTab.id, url:flowTab.url}, reply };
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),20000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

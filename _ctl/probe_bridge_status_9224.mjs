const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html'));
if(!t){console.error('STUDIO_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(async()=>{
  const q=(type)=>new Promise((resolve)=>{
    chrome.runtime.sendMessage({type,requestId:Math.random().toString(36).slice(2)},(resp)=>{resolve(resp); if(chrome.runtime.lastError) resolve({error:chrome.runtime.lastError.message})});
  });
  const account=await q('FLOWGRAPH_ACCOUNT_STATUS');
  const flow=await q('FLOWGRAPH_FLOW_STATUS');
  return {account,flow};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),15000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});
ws.close();
console.log(JSON.stringify(m.result?.result?.value??m.result??m,null,2));

const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html'));
if(!t){console.error('STUDIO_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expression=`(async()=>{
 const call=(type,payload)=>new Promise((resolve)=>chrome.runtime.sendMessage({type,requestId:'live-'+Date.now()+'-'+Math.random(),payload},resolve));
 const created=await call('FLOWGRAPH_PROJECT_CREATE',{projectTitle:'FlowGraph V1 Live 2026-09-02'});
 if(!created?.ok) return {created};
 const projectId=created.data?.projectId;
 const selected=await call('FLOWGRAPH_PROJECT_SELECT',{projectId});
 const listed=await call('FLOWGRAPH_PROJECT_LIST');
 return {created,selected,listed};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg=await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),30000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});ws.close();console.log(JSON.stringify(msg.result?.result?.value??msg,null,2));

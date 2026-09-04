const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html'));
if(!t){console.error('STUDIO_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expression=`(async()=>{
 const call=(type,payload)=>new Promise((resolve)=>chrome.runtime.sendMessage({type,requestId:'probe-'+Date.now()+'-'+Math.random(),payload},resolve));
 const account=await call('FLOWGRAPH_ACCOUNT_STATUS');
 const flow=await call('FLOWGRAPH_FLOW_STATUS');
 const projects=await call('FLOWGRAPH_PROJECT_LIST');
 return {account,flow,projects};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg=await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),30000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});ws.close();
const v=msg.result?.result?.value??msg;
if(v?.account?.data?.email) v.account.data.email='<REDACTED>';
console.log(JSON.stringify(v,null,2));

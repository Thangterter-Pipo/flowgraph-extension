const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function listPages(){const r=await fetch(`${CDP}/json/list`);return r.json();}
function connect(url){
  const ws=new WebSocket(url);
  return new Promise((res,rej)=>{ws.addEventListener('open',()=>res(ws),{once:true});ws.addEventListener('error',rej,{once:true});});
}
function send(ws,method,params={},timeout=8000){
  const id=Date.now()+Math.floor(Math.random()*1e6);
  ws.send(JSON.stringify({id,method,params}));
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error(`${method}_TIMEOUT`)),timeout);
    ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);resolve(m);}});
  });
}
(async()=>{
  const p=await listPages();
  const tabs=p.filter(x=>x.type==='page');
  for(const tab of tabs){
    console.log('\n===',tab.title,'===');
    const ws=await connect(tab.webSocketDebuggerUrl);
    // Try to resume if paused
    try{const d=await send(ws,'Debugger.enable',{},3000);console.log('Debugger.enable',d.error?d.error.message:'ok');}catch(e){console.log('Debugger.enable',e.message);}
    try{const d=await send(ws,'Runtime.runIfWaitingForDebugger',{},3000);console.log('runIfWaiting',d.error?d.error.message:'ok');}catch(e){console.log('runIfWaiting',e.message);}
    try{const d=await send(ws,'Runtime.evaluate',{expression:'document.title',returnByValue:true},6000);console.log('EVAL',JSON.stringify(d.result?.result?.value??d));}catch(e){console.log('EVAL',e.message);}
    ws.close();
  }
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

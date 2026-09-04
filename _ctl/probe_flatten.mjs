const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function connect(url){
  const ws=new WebSocket(url);
  return new Promise((res,rej)=>{ws.addEventListener('open',()=>res(ws),{once:true});ws.addEventListener('error',rej,{once:true});});
}
function send(ws,method,params={},timeout=10000){
  const id=Date.now()+Math.floor(Math.random()*1e6);
  ws.send(JSON.stringify({id,method,params}));
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error(`${method}_TIMEOUT`)),timeout);
    const h=ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}};
    ws.addEventListener('message',h);
  });
}
(async()=>{
  const ver=await (await fetch(`${CDP}/json/version`)).json();
  const ws=await connect(ver.webSocketDebuggerUrl);
  const studioId='D2CBAB4C59FF7F8963AC6FD251A18445';
  const target=await send(ws,'Target.attachToTarget',{targetId:studioId,flatten:true});
  const sessionId=target.result.sessionId;
  console.log('ATTACHED sessionId',sessionId);
  const r=await send(ws,'Runtime.evaluate',{sessionId,expression:'document.readyState+\" / \"+document.title',returnByValue:true});
  console.log('EVAL',JSON.stringify(r));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

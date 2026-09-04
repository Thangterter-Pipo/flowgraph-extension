const CDP='http://127.0.0.1:9224';
function connect(url){return new Promise((res,rej)=>{const ws=new WebSocket(url);ws.addEventListener('open',()=>res(ws),{once:true});ws.addEventListener('error',e=>rej(new Error('WS '+e.message)),{once:true});});}
function send(ws,method,params={},timeout=12000){const id=Date.now()+Math.floor(Math.random()*1e6);ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(method+'_TIMEOUT')),timeout);const h=ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}};ws.addEventListener('message',h);});}
(async()=>{
  const ver=await (await fetch(`${CDP}/json/version`)).json();
  console.log('browser ws',ver.webSocketDebuggerUrl);
  const ws=await connect(ver.webSocketDebuggerUrl);
  const t=await send(ws,'Target.getTargets',{});
  console.log('TARGETS',JSON.stringify(t,null,2));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

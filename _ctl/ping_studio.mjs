const CDP='http://127.0.0.1:9224';
function connect(url){
  return new Promise((res,rej)=>{
    const ws=new WebSocket(url);
    ws.addEventListener('open',()=>res(ws),{once:true});
    ws.addEventListener('error',e=>rej(new Error('WS_ERR '+e.message)),{once:true});
  });
}
function send(ws,method,params={},timeout=12000){
  const id=Date.now()+Math.floor(Math.random()*1e6);
  ws.send(JSON.stringify({id,method,params}));
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error(`${method}_TIMEOUT`)),timeout);
    const h=ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}};
    ws.addEventListener('message',h);
  });
}
(async()=>{
  const studioId='D2CBAB4C59FF7F8963AC6FD251A18445';
  const p=await (await fetch(`${CDP}/json/list`)).json();
  const studio=p.find(x=>x.id===studioId&&x.type==='page');
  if(!studio){console.error('NO_STUDIO');process.exit(2);}
  console.log('USE_WS',studio.webSocketDebuggerUrl);
  const ws=await connect(studio.webSocketDebuggerUrl);
  console.log('OPEN');
  const r=await send(ws,'Runtime.evaluate',{expression:'document.readyState',returnByValue:true});
  console.log('EVAL',JSON.stringify(r));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function connect(url){
  return new Promise((res,rej)=>{
    const ws=new WebSocket(url);
    ws.addEventListener('open',()=>res(ws),{once:true});
    ws.addEventListener('error',e=>rej(new Error('WS '+e.message)),{once:true});
  });
}
function send(ws,method,params={},timeout=10000){
  const id=Date.now()+Math.floor(Math.random()*1e6);
  const msg=JSON.stringify({id,method,params});
  ws.send(msg);
  console.log('SENT',method,msg);
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error(method+'_TIMEOUT')),timeout);
    const h=ev=>{
      const raw=typeof ev.data==='string'?ev.data:Buffer.from(ev.data).toString('utf8');
      console.log('RAW',raw.substring(0,120));
      let m; try{m=JSON.parse(raw);}catch(e){return;}
      if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}
    };
    ws.addEventListener('message',h);
  });
}
(async()=>{
  const ver=await (await fetch(`${CDP}/json/version`)).json();
  const ws=await connect(ver.webSocketDebuggerUrl);
  console.log('CONNECTED');
  const t=await send(ws,'Browser.getVersion',{});
  console.log('RESULT',JSON.stringify(t));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

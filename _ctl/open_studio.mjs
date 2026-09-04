const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function connect(url){return new Promise((res,rej)=>{const ws=new WebSocket(url);ws.addEventListener('open',()=>res(ws),{once:true});ws.addEventListener('error',e=>rej(new Error('WS '+e.message)),{once:true});});}
function send(ws,method,params={},timeout=15000){const id=Math.floor(Math.random()*1e9);ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(method+'_TIMEOUT')),timeout);const h=ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}};ws.addEventListener('message',h);});}
(async()=>{
  const p=await (await fetch(`${CDP}/json/list`)).json();
  let studio=p.find(x=>x.type==='page'&&x.url.includes('studio.html'));
  if(studio){console.log('STUDIO EXISTS',studio.id,studio.url);}
  else{
    const ver=await (await fetch(`${CDP}/json/version`)).json();
    const bw=await connect(ver.webSocketDebuggerUrl);
    await send(bw,'Target.createTarget',{url:'chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html'});
    bw.close();
    console.log('CREATED studio target');
    await sleep(5000);
  }
  // Re-list
  const p2=await (await fetch(`${CDP}/json/list`)).json();
  studio=p2.find(x=>x.type==='page'&&x.url.includes('studio.html'));
  console.log('STUDIO',studio?JSON.stringify({id:studio.id,url:studio.url,title:studio.title}):'NOT_FOUND');
  if(studio){
    const ws=await connect(studio.webSocketDebuggerUrl);
    const r=await send(ws,'Runtime.evaluate',{expression:'JSON.stringify({title:document.title,ready:document.readyState})',returnByValue:true});
    console.log('STATE',r.result?.result?.value);
    ws.close();
  }
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function connect(url){return new Promise((res,rej)=>{const ws=new WebSocket(url);ws.addEventListener('open',()=>res(ws),{once:true});ws.addEventListener('error',e=>rej(new Error('WS '+e.message)),{once:true});});}
function send(ws,method,params={},timeout=20000){const id=Math.floor(Math.random()*1e9);ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(method+'_TIMEOUT')),timeout);const h=ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}};ws.addEventListener('message',h);});}

// Inject real runtime results from verified Run 4 (no signed URLs) then reload.
async function injectAndReload(){
  const p=await (await fetch(`${CDP}/json/list`)).json();
  const studio=p.find(x=>x.type==='page'&&x.url.includes('studio.html'));
  const ws=await connect(studio.webSocketDebuggerUrl);
  const inject=`(()=>{
    const raw=localStorage.getItem('flowgraph.demo.workflow');
    const s=raw?JSON.parse(raw):null;
    if(!s) return {ok:false,reason:'no saved'};
    s.runtimeResults = {
      '2': { type:'image', mediaId:'ff49d846-c300-404f-a2d2-adddc9c31b83', mimeType:'image/jpeg', fileName:'t2i-output.jpg' },
      '3': { type:'video', mediaId:'31e26cf9-dbf3-4538-ad96-acb39a8f4f94', mimeType:'video/mp4', fileName:'i2v-output.mp4' },
      '4': { type:'video', mediaId:'31e26cf9-dbf3-4538-ad96-acb39a8f4f94', mimeType:'video/mp4', fileName:'flowgraph-output.mp4' }
    };
    localStorage.setItem('flowgraph.demo.workflow', JSON.stringify(s));
    return {ok:true,nodeCount:s.nodes?.length,runtimeResults:Object.keys(s.runtimeResults).length};
  })()`;
  const r=await send(ws,'Runtime.evaluate',{expression:inject,returnByValue:true});
  console.log('INJECT',JSON.stringify(r.result?.value??r));
  ws.close();
}
injectAndReload().catch(e=>{console.error('ERR',e.message);process.exit(1);});

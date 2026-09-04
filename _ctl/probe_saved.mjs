const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function listPages(){const r=await fetch(`${CDP}/json/list`);return r.json();}
async function connect(url){
  const ws=new WebSocket(url);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  return ws;
}
async function cdp(ws,method,params={}){
  const id=Date.now()+Math.floor(Math.random()*1e6);
  ws.send(JSON.stringify({id,method,params}));
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error('timeout')),25000);
    ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);resolve(m.result??m);}});
  });
}
(async()=>{
  const p=await listPages();
  const tab=p.find(x=>x.type==='page'&&x.url.includes('studio.html'));
  if(!tab){console.error('NO_STUDIO');process.exit(2);}
  console.log('CONNECT',tab.webSocketDebuggerUrl);
  const ws=await connect(tab.webSocketDebuggerUrl);
  console.log('CONNECTED');
  await cdp(ws,'Runtime.enable');
  await sleep(500);
  const expr=`(()=>{const raw=localStorage.getItem('flowgraph.demo.workflow');const s=raw?JSON.parse(raw):null;return {ok:true,saved:s?{name:s.name,schemaVersion:s.schemaVersion,nodes:s.nodes?.map(n=>({id:n.id,kind:n.data.kind,title:n.data.title,status:n.data.status,result:n.data.result?{type:n.data.result.type,mediaId:n.data.result.mediaId,mimeType:n.data.result.mimeType}:null})),edges:s.edges?.map(e=>({id:e.id,source:e.source,target:e.target}))}:null};})()`;
  const r=await cdp(ws,'Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  console.log(JSON.stringify(r.result?.value??r,null,2));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

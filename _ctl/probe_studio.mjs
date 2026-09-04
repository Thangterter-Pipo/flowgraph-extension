const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function connect(url){return new Promise((res,rej)=>{const ws=new WebSocket(url);ws.addEventListener('open',()=>res(ws),{once:true});ws.addEventListener('error',e=>rej(new Error('WS '+e.message)),{once:true});});}
function send(ws,method,params={},timeout=20000){const id=Math.floor(Math.random()*1e9);ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(method+'_TIMEOUT')),timeout);const h=ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}};ws.addEventListener('message',h);});}
(async()=>{
  const p=await (await fetch(`${CDP}/json/list`)).json();
  const studio=p.find(x=>x.type==='page'&&x.url.includes('studio.html'));
  const ws=await connect(studio.webSocketDebuggerUrl);
  const expr=`(async()=>{
    const q=(type,payload)=>new Promise((resolve)=>{
      const id=Math.random().toString(36).slice(2);
      const msg=payload?{type,requestId:id,payload}:{type,requestId:id};
      chrome.runtime.sendMessage(msg,(resp)=>{ if(chrome.runtime.lastError) resolve({error:chrome.runtime.lastError.message}); else resolve(resp); });
    });
    const account=await q('FLOWGRAPH_ACCOUNT_STATUS');
    const flow=await q('FLOWGRAPH_FLOW_STATUS');
    const raw=localStorage.getItem('flowgraph.demo.workflow');
    const s=raw?JSON.parse(raw):null;
    return {
      hasCanvas: !!document.querySelector('.react-flow'),
      nodeCards: document.querySelectorAll('.react-flow__node').length,
      locked: !!document.querySelector('.canvas-gate-overlay'),
      saved: s?{name:s.name,schemaVersion:s.schemaVersion,nodes:s.nodes?.map(n=>({id:n.id,kind:n.data.kind,title:n.data.title,status:n.data.status,result:n.data.result?{type:n.data.result.type,mediaId:n.data.result.mediaId,mimeType:n.data.result.mimeType}:null})),edges:s.edges?.map(e=>({id:e.id,source:e.source,target:e.target})),projectBinding:s.projectBinding,runtimeResults:s.runtimeResults}:null,
      account: account?.data,
      flow: flow?.data,
      activeProject: JSON.parse(localStorage.getItem('flowgraph.activeProject')||'null')
    };
  })()`;
  const r=await send(ws,'Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
  console.log(JSON.stringify(r.result?.value??r,null,2));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

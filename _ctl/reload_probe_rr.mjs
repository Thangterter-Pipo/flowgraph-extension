const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function connect(url){return new Promise((res,rej)=>{const ws=new WebSocket(url);ws.addEventListener('open',()=>res(ws),{once:true});ws.addEventListener('error',e=>rej(new Error('WS '+e.message)),{once:true});});}
function send(ws,method,params={},timeout=20000){const id=Math.floor(Math.random()*1e9);ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(method+'_TIMEOUT')),timeout);const h=ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}};ws.addEventListener('message',h);});}
async function findStudio(){const p=await (await fetch(`${CDP}/json/list`)).json();return p.find(x=>x.type==='page'&&x.url.includes('studio.html'));}
(async()=>{
  const studio=await findStudio();
  let ws=await connect(studio.webSocketDebuggerUrl);
  await send(ws,'Page.reload',{ignoreCache:true});
  await sleep(7000);
  ws.close();
  const p2=await (await fetch(`${CDP}/json/list`)).json();
  const studio2=p2.find(x=>x.type==='page'&&x.url.includes('studio.html'));
  ws=await connect(studio2.webSocketDebuggerUrl);
  const probe=`(()=>{
    const s=JSON.parse(localStorage.getItem('flowgraph.demo.workflow'));
    return {
      hasCanvas: !!document.querySelector('.react-flow'),
      nodeCards: document.querySelectorAll('.react-flow__node').length,
      locked: !!document.querySelector('.canvas-gate-overlay'),
      runDisabled: (Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').trim()==='Run Workflow')||{}).disabled ?? null,
      runtimeResultsCount: s.runtimeResults?Object.keys(s.runtimeResults).length:0,
      runtimeResults: s.runtimeResults
    };
  })()`;
  const r=await send(ws,'Runtime.evaluate',{expression:probe,returnByValue:true});
  console.log('RESTORED',JSON.stringify(r.result?.value??r,null,2));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

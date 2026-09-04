const CDP='http://127.0.0.1:9224';
function connect(url){return new Promise((res,rej)=>{const ws=new WebSocket(url);ws.addEventListener('open',()=>res(ws),{once:true});ws.addEventListener('error',e=>rej(new Error('WS '+e.message)),{once:true});});}
function send(ws,method,params={},timeout=20000){const id=Math.floor(Math.random()*1e9);ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(method+'_TIMEOUT')),timeout);const h=ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);ws.removeEventListener('message',h);resolve(m);}};ws.addEventListener('message',h);});}
(async()=>{
  const p=await (await fetch(`${CDP}/json/list`)).json();
  const studio=p.find(x=>x.type==='page'&&x.url.includes('studio.html'));
  const ws=await connect(studio.webSocketDebuggerUrl);
  const probe=`(()=>{
    const nodes=Array.from(document.querySelectorAll('.react-flow__node'));
    return {
      nodeCount: nodes.length,
      nodes: nodes.map(n=>({
        id:n.getAttribute('data-id')||n.id,
        className:n.className,
        status:(n.querySelector('[data-node-status]')?.getAttribute('data-node-status'))||null,
        hasImg: !!n.querySelector('img'),
        hasVideo: !!n.querySelector('video'),
        imgSrc: n.querySelector('img')?.src?.replace(/\\?.*$/,'')||null,
        videoSrc: n.querySelector('video')?.src?.replace(/\\?.*$/,'')||null,
        statusBadge: (n.querySelector('.fg-badge')?.innerText||'').trim()||null,
        resultText: (n.innerText||'').match(/No result yet/i) ? 'NO_RESULT' : null
      }))
    };
  })()`;
  const r=await send(ws,'Runtime.evaluate',{expression:probe,returnByValue:true});
  console.log(JSON.stringify(r.result?.value??r,null,2));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

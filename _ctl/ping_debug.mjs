const CDP='http://127.0.0.1:9224';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function listPages(){const r=await fetch(`${CDP}/json/list`);return r.json();}
(async()=>{
  const p=await listPages();
  for(const tab of p.filter(x=>x.type==='page')){
    console.log('---',tab.title,tab.id);
    const ws=new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
    const id=Date.now();
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:'1+1',returnByValue:true}}));
    const result=await Promise.race([
      new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('EVAL_TIMEOUT')),8000);ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id===id){clearTimeout(t);resolve(m);}});}),
    ]);
    console.log('EVAL',JSON.stringify(result));
    ws.close();
  }
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});

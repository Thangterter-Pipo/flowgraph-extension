const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
// Re-open Studio: navigate the former studio target back to studio.html
const t=pages.find(x=>x.id==='D2CBAB4C59FF7F8963AC6FD251A18445');
if(t){
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
  ws.send(JSON.stringify({id:1,method:'Page.navigate',params:{url:'chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html'}}));
  await new Promise((resolve)=>{const to=setTimeout(resolve,4000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);resolve()}})});
  ws.close();
  console.log('NAV_STUDIO_DONE');
} else console.error('STUDIO_TARGET_MISSING');

const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const img=document.querySelector('img[src*="getMediaUrlRedirect"]');
  if(!img) return {ok:false,reason:'no-image'};
  const a=img.closest('a[href]');
  if(!a) return {ok:false,reason:'no-anchor'};
  const href=a.getAttribute('href');
  const r=a.getBoundingClientRect();
  const info={href,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  // Trigger a real navigation by clicking the anchor's inner area (not dispatch click on div)
  a.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));
  a.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,button:0}));
  a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
  return {ok:true,info};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log('CLICK',JSON.stringify(m.result?.result?.value??m));
await new Promise(r=>setTimeout(r,2000));
const pages2=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const flow=pages2.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
console.log('URL_NOW',flow?.url);

const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
let seq=0;const pending=new Map();
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const f=pending.get(m.id);if(f){pending.delete(m.id);f(m)}});
function call(method,params={}){const id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{pending.set(id,res);setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method))}},12000)})}
const p=await call('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
  const mediaId='f59a1f3a-06e9-4ba4-a900-98c0b135be85';
  const img=Array.from(document.querySelectorAll('img')).find(i=>(i.src||i.currentSrc||'').includes(mediaId));
  if(!img)return {ok:false,reason:'no-img'};
  const r=img.getBoundingClientRect();
  return {ok:true,x:r.left+r.width/2,y:r.top+r.height/2,w:Math.round(r.width),h:Math.round(r.height)};
})()`});
const center=p.result?.result?.value;console.log('CENTER',JSON.stringify(center));
if(center?.ok){
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:center.x,y:center.y});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:center.x,y:center.y,button:'left',buttons:1,clickCount:1});
  await new Promise(r=>setTimeout(r,80));
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:center.x,y:center.y,button:'left',buttons:0,clickCount:1});
  console.log('CLICKED');
}
await new Promise(r=>setTimeout(r,2000));
const st=await call('Runtime.evaluate',{returnByValue:true,expression:`(()=>({url:location.href,title:document.title}))()`});
console.log('AFTER',JSON.stringify(st.result?.result?.value));
ws.close();

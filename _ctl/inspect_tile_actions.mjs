const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
function cdp(expr){
  return new Promise(async (resolve)=>{
    const ws=new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
    const id=1;
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
    const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),12000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===id){clearTimeout(to);res(x)}})});
    ws.close();
    resolve(m.result?.result?.value);
  });
}
const mediaId='f59a1f3a-06e9-4ba4-a900-98c0b135be85';
const out=await cdp(`((mediaId)=>{
  const img=Array.from(document.querySelectorAll('img')).find(i=>(i.src||i.currentSrc||'').includes(mediaId));
  if(!img)return {ok:false,reason:'no-img'};
  const container=img.closest('[role="button"]')||img.parentElement;
  if(!container)return {ok:false,reason:'no-container'};
  const buttons=Array.from(container.querySelectorAll('button')).map(b=>({text:(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,50),aria:b.getAttribute('aria-label'),icon:Array.from(b.querySelectorAll('i')).map(i=>(i.textContent||'').trim()).join('|')}));
  const all=[];
  let cur=img;
  for(let i=0;i<6&&cur;i++){
    const els=Array.from(cur.querySelectorAll('button,[role="button"],[aria-label]')).map(el=>({tag:el.tagName,role:el.getAttribute('role'),aria:el.getAttribute('aria-label'),text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60),testid:el.getAttribute('data-testid')}));
    all.push({level:i,els:els.filter(e=>e.aria||e.text||e.role||e.testid)});
    cur=cur.parentElement;
  }
  return {ok:true,buttons,all};
})(${JSON.stringify(mediaId)})`);
console.log(JSON.stringify(out,null,2));

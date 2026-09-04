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
  const candidates=Array.from(document.querySelectorAll('img, video, a, [data-media-id]'));
  const matches=el=>{const values=[el.getAttribute?.('data-media-id'),el.getAttribute?.('src'),el.getAttribute?.('href'),el.currentSrc,el.src,el.href].filter(Boolean).map(String);return values.some(v=>v.includes(mediaId));};
  const mediaEl=candidates.find(matches);
  if(!mediaEl)return {ok:false,reason:'media-not-found'};
  const info={
    mediaTag:mediaEl.tagName,
    mediaOuter:mediaEl.outerHTML.slice(0,600),
  };
  // climb up 6 ancestors and record tag, role, attrs, aria, class, text
  let cur=mediaEl;
  const chain=[];
  for(let i=0;i<7 && cur;i++){
    const r=cur.getBoundingClientRect();
    chain.push({
      level:i,tag:cur.tagName,role:cur.getAttribute('role'),cls:(cur.className||'').toString().slice(0,80),
      ariaLabel:cur.getAttribute('aria-label'),ariaPressed:cur.getAttribute('aria-pressed'),ariaSelected:cur.getAttribute('aria-selected'),ariaDisabled:cur.getAttribute('aria-disabled'),
      hasTabIndex:cur.hasAttribute('tabindex'),href:cur.getAttribute('href'),dataTestid:cur.getAttribute('data-testid'),
      text:(cur.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60),
      rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}
    });
    cur=cur.parentElement;
  }
  return {ok:true,info,chain};
})(${JSON.stringify(mediaId)})`);
console.log(JSON.stringify(out,null,2));

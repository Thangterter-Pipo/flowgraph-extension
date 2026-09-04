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

const before=await cdp(`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  const ed=document.querySelector('[contenteditable="true"]');
  return {url:location.href,chip:chip?chip.innerText.replace(/\\s+/g,' ').trim():null,edText:(ed?.textContent||'').slice(0,100)};
})()`);
console.log('BEFORE',JSON.stringify(before));

const sel=await cdp(`((mediaId)=>{
  const candidates=Array.from(document.querySelectorAll('img, video, a, [data-media-id]'));
  const matches=el=>{const values=[el.getAttribute?.('data-media-id'),el.getAttribute?.('src'),el.getAttribute?.('href'),el.currentSrc,el.src,el.href].filter(Boolean).map(String);return values.some(v=>v.includes(mediaId));};
  const mediaEl=candidates.find(matches);
  if(!mediaEl)return {ok:false,reason:'media-not-found'};
  let clickable=mediaEl.closest?.('button, [role="button"], [data-testid], [tabindex]');
  if(!clickable)clickable=mediaEl.parentElement;
  if(!clickable)return {ok:false,reason:'not-clickable'};
  const r=clickable.getBoundingClientRect();
  const info={tag:clickable.tagName,role:clickable.getAttribute('role'),mediaTag:mediaEl.tagName,href:clickable.getAttribute('href'),rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  clickable.scrollIntoView?.({block:'center',inline:'center'});
  ['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(type=>{const C=type.startsWith('pointer')?PointerEvent:MouseEvent;clickable.dispatchEvent(new C(type,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}));});
  return {ok:true,info};
})(${JSON.stringify(mediaId)})`);
console.log('SELECT',JSON.stringify(sel));
await new Promise(r=>setTimeout(r,2000));

const after=await cdp(`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  const ed=document.querySelector('[contenteditable="true"]');
  const genBtn=Array.from(document.querySelectorAll('button')).find(b=>Array.from(b.querySelectorAll('i.google-symbols,.google-symbols')).some(i=>(i.textContent||'').trim()==='arrow_forward'));
  const img=document.querySelector('img[src*="getMediaUrlRedirect"]');
  const node=document.querySelector('[data-node-id], [aria-pressed="true"], [aria-selected="true"]');
  return {url:location.href,chip:chip?chip.innerText.replace(/\\s+/g,' ').trim():null,edText:(ed?.textContent||'').slice(0,100),genDisabled:genBtn?(genBtn.disabled||genBtn.getAttribute('aria-disabled')==='true'):null,genText:genBtn?genBtn.innerText.replace(/\\s+/g,' ').trim():null,imgSrc:img?(img.currentSrc||img.src||'').slice(0,140):null,selectedNode:node?(node.outerHTML||'').slice(0,300):null};
})()`);
console.log('AFTER',JSON.stringify(after));

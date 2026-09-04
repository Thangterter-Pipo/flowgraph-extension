const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const page = pages.find(x=>(x.url||'').includes('labs.google/fx') && x.type==='page');
if(!page){console.error('FLOW_NOT_FOUND');process.exit(2)}
let seq=0;const pending=new Map();
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const f=pending.get(m.id);if(f){pending.delete(m.id);f(m)}});
function call(method,params={}){const id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{pending.set(id,res);setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method))}},15000)})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ev(expr){const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return {__err:r.exceptionDetails.text+':'+(r.result?.result?.value?'':''),exc:r.exceptionDetails.exception?.description||r.exceptionDetails.text};return r.result?.result?.value}
async function snap(label){const v=await ev(`(()=>{
  const chip=Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-haspopup')==='menu'&&((b.innerText||'').includes('Video ·')||(b.innerText||'').includes('Nano Banana')));
  const menus=Array.from(document.querySelectorAll('[role="menu"][data-state="open"],[role="dialog"][data-state="open"],[data-radix-menu-content]'));
  const ed=document.querySelector('[contenteditable="true"]');
  const gen=Array.from(document.querySelectorAll('button')).find(b=>Array.from(b.querySelectorAll('i.google-symbols,.google-symbols')).some(i=>(i.textContent||'').trim()==='arrow_forward'));
  return {url:location.href,chip:chip?(chip.innerText||'').replace(/\\s+/g,' ').trim():null,ed:(ed?.textContent||'').slice(0,80),genDisabled:gen?(gen.disabled||gen.getAttribute('aria-disabled')==='true'):null,menus:menus.map(m=>({role:m.getAttribute('role'),state:m.getAttribute('data-state'),text:(m.innerText||'').replace(/\\s+/g,' ').trim().slice(0,300)}))};
})()`);
  console.log('['+label+']',JSON.stringify(v));
}
const mediaId=process.argv[2]||'f59a1f3a-06e9-4ba4-a900-98c0b135be85';
await ev(`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));return true})()`);
await sleep(300);
await snap('initial');

// get tile center
const c=await ev(`((mediaId)=>{const img=Array.from(document.querySelectorAll('img')).find(i=>(i.src||i.currentSrc||'').includes(mediaId));if(!img)return {ok:false,reason:'no-img'};const r=img.getBoundingClientRect();return {ok:true,x:r.left+r.width/2,y:r.top+r.height/2};})(${JSON.stringify(mediaId)})`);
console.log('center',JSON.stringify(c));
if(c?.ok){await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:c.x,y:c.y});await sleep(500)}

// find more_vert btn
const mv=await ev(`((mediaId)=>{const img=Array.from(document.querySelectorAll('img')).find(i=>(i.src||i.currentSrc||'').includes(mediaId));if(!img)return {ok:false,reason:'no-img'};const container=img.closest('[role="button"]')||img.parentElement;const btn=Array.from(container.querySelectorAll('button')).find(b=>(b.innerText||'').includes('Khác')||(b.textContent||'').includes('more_vert'));if(!btn)return {ok:false,reason:'no-more'};const r=btn.getBoundingClientRect();return {ok:true,x:r.left+r.width/2,y:r.top+r.height/2,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};})(${JSON.stringify(mediaId)})`);
console.log('more_vert',JSON.stringify(mv));
if(mv?.ok){
  // Try SYNTHETIC fire first (service-worker style)
  await ev(`(()=>{const img=Array.from(document.querySelectorAll('img')).find(i=>(i.src||i.currentSrc||'').includes(${JSON.stringify(mediaId)}));const container=img.closest('[role="button"]')||img.parentElement;const btn=Array.from(container.querySelectorAll('button')).find(b=>(b.innerText||'').includes('Khác')||(b.textContent||'').includes('more_vert'));if(!btn)return false;const fire=(el)=>{['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{const C=t.startsWith('pointer')?PointerEvent:MouseEvent;el.dispatchEvent(new C(t,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}))})};fire(btn);return true})()`);
  await sleep(700);
  await snap('after_synthetic_more');
  // close if opened
  await ev(`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));return true})()`);
  await sleep(400);

  // Now PHYSICAL click
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:mv.x,y:mv.y});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:mv.x,y:mv.y,button:'left',buttons:1,clickCount:1});
  await sleep(80);
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:mv.x,y:mv.y,button:'left',buttons:0,clickCount:1});
  await sleep(700);
  await snap('after_physical_more');
}
ws.close();

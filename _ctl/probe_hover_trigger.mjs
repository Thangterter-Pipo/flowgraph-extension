const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const page = pages.find(x=>(x.url||'').includes('labs.google/fx') && x.type==='page');
if(!page){console.error('FLOW_NOT_FOUND');process.exit(2)}
let seq=0;const pending=new Map();
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const f=pending.get(m.id);if(f){pending.delete(m.id);f(m)}});
function call(method,params={}){const id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{pending.set(id,res);setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method))}},20000)})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mediaId = process.argv[2] || '883af4be-4a44-41cd-87fe-62e4cb10ed0c';
const ev = async (expr)=>{const r=await call('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});return r.result?.result?.value};
async function hasMoreBtn(){
  return await ev(`(()=>{const img=Array.from(document.querySelectorAll('img')).find(i=>(i.src||i.currentSrc||'').includes(${JSON.stringify(mediaId)}));if(!img)return {ok:false,reason:'no-img'};const container=img.closest('[role="button"]')||img.parentElement;const btn=Array.from(container.querySelectorAll('button')).find(b=>(b.innerText||'').includes('Khác')||(b.textContent||'').includes('more_vert'));return {ok:true, found:!!btn};})()`);
}
// close menus
await ev(`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));return true})()`);
await sleep(300);
console.log('BEFORE_HOVER', JSON.stringify(await hasMoreBtn()));
// Try synthetic fire on tile
await ev(`(()=>{const img=Array.from(document.querySelectorAll('img')).find(i=>(i.src||i.currentSrc||'').includes(${JSON.stringify(mediaId)}));const tile=img.closest('[role="button"]')||img.parentElement;const fire=(el)=>{['pointerover','pointerenter','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{const C=t.startsWith('pointer')?PointerEvent:MouseEvent;el.dispatchEvent(new C(t,{bubbles:true,cancelable:true,pointerType:'mouse',button:0}))})};fire(tile);return true})()`);
await sleep(500);
console.log('AFTER_SYNTHETIC_FIRE', JSON.stringify(await hasMoreBtn()));
// Now real mouseMoved to tile center
const c=await ev(`(()=>{const img=Array.from(document.querySelectorAll('img')).find(i=>(i.src||i.currentSrc||'').includes(${JSON.stringify(mediaId)}));const r=img.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:c.x,y:c.y});
await sleep(500);
console.log('AFTER_REAL_MOUSEMOVE', JSON.stringify(await hasMoreBtn()));
ws.close();

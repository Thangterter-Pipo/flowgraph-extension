const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const chips=Array.from(document.querySelectorAll('button')).filter(b=>(b.innerText||'').trim()).map(b=>({text:(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,80),aria:b.getAttribute('aria-label'),hasMenu:b.getAttribute('aria-haspopup'),disabled:b.disabled||b.getAttribute('aria-disabled')==='true',rect:(()=>{const r=b.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})()}));
  const modelChip=chips.find(c=>c.hasMenu==='menu'||c.text.includes('Nano Banana')||c.text.includes('Video'));
  const editor=document.querySelector('[contenteditable="true"]');
  const editorText=(editor?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120);
  return {chips:chips.slice(0,25),modelChip,editorText,url:location.href};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();
console.log(JSON.stringify(m.result?.result?.value??m,null,2));

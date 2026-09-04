const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  const ed=document.querySelector('[contenteditable="true"]');
  const buttons=Array.from(document.querySelectorAll('button')).map((b,i)=>({i,text:(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60),aria:b.getAttribute?.('aria-label'),icon:Array.from(b.querySelectorAll('i')).map(x=>(x.textContent||'').trim()).join('|')})).filter(x=>x.text||x.icon||x.aria);
  // Look for image tile still present and media elements
  const imgs=Array.from(document.querySelectorAll('img')).map(i=>({src:(i.currentSrc||i.src||'').slice(0,140),alt:i.alt})).filter(x=>x.src);
  return {edText:ed?.textContent?.slice(0,80),buttons,imgs};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log(JSON.stringify(m.result?.result?.value??m,null,2));

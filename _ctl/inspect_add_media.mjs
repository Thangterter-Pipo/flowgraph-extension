const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expr=`(()=>{
  // Find the "add / Thêm nội dung nghe nhìn" button and nearby buttons
  const buttons=Array.from(document.querySelectorAll('button')).map((b,i)=>({i,text:(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,60),aria:b.getAttribute?.('aria-label'),title:b.getAttribute?.('title'),icon:Array.from(b.querySelectorAll('i')).map(x=>(x.textContent||'').trim()).join('|')})).filter(x=>x.text||x.icon||x.aria);
  // Inspect the prompt composer area near the add button
  const ed=document.querySelector('[contenteditable="true"]');
  const edWrap=ed?.closest?.('div')?.parentElement;
  return {buttons, edOuter:edWrap?.outerHTML?.slice(0,1200)};
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
const m=await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error('timeout')),10000);ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1){clearTimeout(to);res(x)}})});ws.close();console.log(JSON.stringify(m.result?.result?.value??m,null,2));

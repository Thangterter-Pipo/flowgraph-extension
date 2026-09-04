const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('chrome-extension://') && (x.url||'').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(() => ({
  title: document.title,
  bodyText: (document.body?.innerText || '').slice(0,5000),
  buttons: Array.from(document.querySelectorAll('button')).slice(0,120).map((b,i)=>({i,text:(b.innerText||'').trim(),aria:b.getAttribute('aria-label'),disabled:b.disabled})),
  selects: Array.from(document.querySelectorAll('select')).map((s,i)=>({i,value:s.value,options:Array.from(s.options).map(o=>({text:o.text,value:o.value,selected:o.selected}))})),
  inputs: Array.from(document.querySelectorAll('input')).map((el,i)=>({i,type:el.type,value:el.value,placeholder:el.placeholder,disabled:el.disabled})),
  locked: !!Array.from(document.querySelectorAll('*')).find(el => (el.textContent||'').trim()==='PROJECT REQUIRED')
}))()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),15000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

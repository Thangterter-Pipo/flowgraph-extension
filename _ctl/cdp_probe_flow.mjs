const port=9223;
const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const target=pages.find(x=>(x.url||'').includes('labs.google/fx/tools/flow')&&x.type==='page');
if(!target){console.error('TARGET_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expression=`({url:location.href,title:document.title,hasGrecaptcha:!!(window.grecaptcha&&window.grecaptcha.enterprise&&window.grecaptcha.enterprise.execute),editorCount:document.querySelectorAll('[contenteditable=true]').length,buttonCount:document.querySelectorAll('button').length,bodyText:(document.body&&document.body.innerText||'').slice(0,1500)})`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('timeout')),10000);ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id===1){clearTimeout(t);resolve(m)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value??msg,null,2));

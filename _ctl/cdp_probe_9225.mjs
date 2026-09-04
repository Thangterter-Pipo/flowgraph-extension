const pages=await fetch('http://127.0.0.1:9225/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('/project/9125da34-52c4-4f38-a8cc-7d6e1bb31483')&&x.type==='page');
if(!t){console.error('TARGET_NOT_FOUND');process.exit(2)}
console.error('TARGET',t.id,t.url);
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
let seq=0; const pending=new Map();
ws.addEventListener('message',ev=>{const m=JSON.parse(typeof ev.data==='string'?ev.data:Buffer.from(ev.data).toString()); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
function call(method,params={}){const id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{pending.set(id,res);setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method))}},10000)})}
await call('Runtime.enable');
const r=await call('Runtime.evaluate',{expression:`(async()=>{const s=await fetch('https://labs.google/fx/api/auth/session',{credentials:'include'});const j=await s.json().catch(()=>null);return {title:document.title,url:location.href,status:s.status,hasAccessToken:!!j?.access_token,user:j?.user?{email:j.user.email,name:j.user.name}:null,grecaptcha:!!window.grecaptcha?.enterprise?.execute,editors:document.querySelectorAll('[contenteditable=true]').length,body:(document.body?.innerText||'').slice(0,1000)}})()`,returnByValue:true,awaitPromise:true,userGesture:true});
console.log(JSON.stringify(r.result?.result?.value??r,null,2));
ws.close();

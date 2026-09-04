const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html'));
if(!t){console.error('STUDIO_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
let seq=0;const pending=new Map();ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);const r=pending.get(x.id);if(r){pending.delete(x.id);r(x)}});
function call(method,params={}){const id=++seq;ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{pending.set(id,resolve);setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error('timeout '+method))}},15000)})}
async function evalv(expression){const m=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});return m.result?.result?.value}
const clicked=await evalv(`(() => {const b=Array.from(document.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='Run Workflow'); if(!b)return {ok:false,reason:'not-found'}; if(b.disabled)return {ok:false,reason:'disabled'}; b.click(); return {ok:true};})()`);
console.log('CLICK',JSON.stringify(clicked));
const started=Date.now();let last='';
while(Date.now()-started<360000){
  await new Promise(r=>setTimeout(r,4000));
  const state=await evalv(`(() => {const p=document.querySelector('.execution-panel'); if(!p)return {missing:true}; const cards=Array.from(p.querySelectorAll('.run-node-card')).map(c=>({title:c.querySelector('.run-node-title')?.innerText?.trim(),status:c.querySelector('.fg-badge')?.innerText?.trim(),meta:c.querySelector('.run-node-meta')?.innerText?.trim()})); const head=p.querySelector('.execution-head .fg-badge')?.innerText?.trim(); const summary=Array.from(p.querySelectorAll('.summary-row')).map(r=>r.innerText.trim()); return {head,cards,summary};})()`);
  const s=JSON.stringify(state); if(s!==last){console.log(new Date().toISOString(),s); last=s;}
  if(state?.head==='SUCCESS'||state?.head==='FAILED'){console.log('FINAL',JSON.stringify(state,null,2));ws.close();process.exit(state.head==='SUCCESS'?0:3)}
}
console.log('FINAL_TIMEOUT');ws.close();process.exit(4);

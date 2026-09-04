import { writeFileSync } from 'node:fs';
const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').includes('labs.google/fx')&&x.type==='page');
if(!t){console.error('FLOW_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
ws.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png'}}));
const m=await new Promise((res)=>{ws.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===1)res(x)},{once:false})});
ws.close();
const b64=m.result?.data;
if(!b64){console.error('NO_SCREENSHOT',JSON.stringify(m).slice(0,400));process.exit(2)}
const out='E:/Flow_veo/_ctl/live_flow_state.png';
writeFileSync(out,Buffer.from(b64,'base64'));
console.log('SAVED',out);

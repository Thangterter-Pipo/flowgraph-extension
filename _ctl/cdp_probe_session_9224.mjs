const pages = await fetch('http://127.0.0.1:9224/json/list').then(r => r.json());
const t = pages.find(x => (x.url || '').includes('labs.google/fx') && x.type === 'page');
if (!t) { console.error('TARGET_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
const expression = `(async()=>{try{const r=await fetch('https://labs.google/fx/api/auth/session',{credentials:'include'});const j=await r.json().catch(()=>null);return {status:r.status,ok:r.ok,hasAccessToken:!!j?.access_token,user:j?.user?{email:j.user.email,name:j.user.name}:null,expires:j?.expires||null};}catch(e){return {error:String(e)}}})()`;
const reqId = Math.floor(Math.random() * 1e9);
ws.send(JSON.stringify({ id: reqId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
const m = await new Promise((resolve, reject) => {
  const tt = setTimeout(() => reject(new Error('timeout')), 10000);
  ws.addEventListener('message', ev => {
    const x = JSON.parse(ev.data);
    if (x.id === reqId) { clearTimeout(tt); resolve(x); }
  });
});
ws.close();
console.log(JSON.stringify(m.result?.result?.value ?? m, null, 2));

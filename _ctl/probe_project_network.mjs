const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
let id = 0;
const send = (method, params={}) => { const cid = ++id; ws.send(JSON.stringify({id:cid,method,params})); return cid; };
const entries = [];
let resolveDone;
const done = new Promise(r=>{resolveDone=r;});
const trigger = Date.now();
ws.addEventListener('message', ev => {
  const x = JSON.parse(ev.data);
  if (x.method === 'Network.requestWillBeSent' && /project\./i.test(x.params?.request?.url || '')) {
    entries.push({ url: x.params.request.url, method: x.params.request.method, postData: x.params.request.postData || null });
  }
  if (x.method === 'Network.loadingFinished') {
    // keep collecting; stop after 25s or when a search hit appears
  }
  if (Date.now() - trigger > 22000) {
    resolveDone(entries);
  }
});
send('Network.enable');
send('Page.enable');
send('Page.reload', { ignoreCache: true });
const out = await Promise.race([done, new Promise(r=>setTimeout(()=>r(entries), 25000))]);
ws.close();
console.log(JSON.stringify(out, null, 2));

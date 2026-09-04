const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
let id = 0;
const send = (method, params={}) => { const cid = ++id; ws.send(JSON.stringify({id:cid,method,params})); return cid; };
const entries = [];
const trigger = Date.now();
ws.addEventListener('message', ev => {
  const x = JSON.parse(ev.data);
  if (x.method === 'Network.requestWillBeSent') {
    const url = x.params?.request?.url || '';
    if (/project\.|searchUser|createProject/i.test(url)) {
      entries.push({ url, method: x.params.request.method, postData: x.params.request.postData || null });
    }
  }
});
send('Network.enable');
send('Page.enable');
send('Page.navigate', { url: 'https://labs.google/fx/tools/flow' });
await new Promise(r=>setTimeout(r, 18000));
ws.close();
console.log(JSON.stringify(entries, null, 2));

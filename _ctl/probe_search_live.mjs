const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
let id = 0;
const send = (method, params={}) => { const cid = ++id; ws.send(JSON.stringify({id:cid,method,params})); return cid; };
// Trap fetch by injecting into MAIN world.
send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const orig = window.fetch.bind(window);
    window.__flowFetchLog = [];
    window.fetch = function(url, opts) {
      const u = (typeof url === 'string') ? url : (url && url.url ? url.url : String(url));
      if (/project\\./i.test(u)) {
        window.__flowFetchLog.push({ url: u, method: (opts && opts.method) || 'GET', postData: (opts && opts.body) || null, at: Date.now() });
      }
      return orig(url, opts);
    };
  })();`
});
send('Page.enable');
send('Page.reload', { ignoreCache: true });
await new Promise(r=>setTimeout(r, 8000));
const evalRes = await send('Runtime.evaluate', {
  expression: `window.__flowFetchLog || []`,
  returnByValue: true,
});
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),15000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===evalRes){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value, null, 2));

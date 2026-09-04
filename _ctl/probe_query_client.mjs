const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(() => {
  const out = {};
  // Common React 18 / @tanstack/react-query internals
  function findQueries(root, depth, seen) {
    if (!root || depth > 4 || seen.has(root)) return [];
    seen.add(root);
    const out = [];
    if (root && typeof root === 'object') {
      if (root['queryCache'] && root['queries'] && typeof root['queries'] === 'object') {
        out.push({ type: 'query_client', keys: Object.keys(root['queries'].queries ? root['queries'].queries : {}).slice(0,20), qc: root });
      }
      if (root['getQueryCache'] && typeof root['getQueryCache'] === 'function') {
        try { const qc = root['getQueryCache'](); const all = qc['getAll'] ? qc['getAll']() : []; out.push({ type: 'react_query_client', count: all.length, queries: all.map(q => String(q.queryKey)).slice(0,20) }); } catch {}
      }
    }
    for (const k of Object.keys(root)) {
      const v = root[k];
      if (v && typeof v === 'object') out.push(...findQueries(v, depth+1, seen));
    }
    return out;
  }
  const seen = new Set();
  const nodes = [];
  for (const mk of [window, document, document.body]) {
    try { nodes.push(...findQueries(mk, 0, seen)); } catch {}
  }
  out.nodes = nodes.slice(0, 30);
  out.probe = 'done';
  return out;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),15000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

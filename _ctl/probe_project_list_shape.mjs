const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(async () => {
  const inputParam = encodeURIComponent(JSON.stringify({ json: { toolName: 'STUDIO_FX' } }));
  const res = await fetch('https://labs.google/fx/api/trpc/project.searchUserProjects?input=' + inputParam, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  // Sanitized structural summary: keys + count, no token/cookie/secrets.
  const shape = (v, depth) => {
    if (depth > 2) return typeof v === 'object' && v !== null ? '...' : v;
    if (v === null) return 'null';
    if (Array.isArray(v)) return { __arrayLen: v.length, __type0: v.length ? shape(v[0], depth+1) : 'empty' };
    if (typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) {
        const val = v[k];
        if (/token|cookie|auth|secret|bearer|access/i.test(k)) { out[k] = '<redacted>'; continue; }
        out[k] = shape(val, depth+1);
      }
      return out;
    }
    return v;
  };
  return { httpStatus: res.status, ok: res.ok, parsed: json, shape: shape(json, 0) };
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),20000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

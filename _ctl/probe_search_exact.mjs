const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const inputs = [
  { json: { pageSize: 20, toolName: 'PINHOLE', cursor: null }, meta: { values: { cursor: ['undefined'] } } },
  { json: { pageSize: 20, toolName: 'PINHOLE', cursor: null } },
  { json: { pageSize: 20, toolName: 'PINHOLE' } },
];
const expression = `(async () => {
  const inputs = ${JSON.stringify(inputs)};
  const out = [];
  for (const input of inputs) {
    const inputParam = encodeURIComponent(JSON.stringify(input));
    const res = await fetch('https://labs.google/fx/api/trpc/project.searchUserProjects?input=' + inputParam, {
      method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' },
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    const msg = json?.error?.json?.message;
    const r = json?.result?.data?.json?.result;
    const shape = (v, depth) => {
      if (depth > 2) return v === null ? 'null' : typeof v;
      if (Array.isArray(v)) return { __len: v.length, __t0: v.length ? shape(v[0], depth+1) : 'empty' };
      if (v && typeof v === 'object') { const o={}; for (const k of Object.keys(v)) { if (/token|cookie|auth|secret|bearer|access/i.test(k)) o[k]='<redacted>'; else o[k]=shape(v[k],depth+1); } return o; }
      return v;
    };
    out.push({ input, httpStatus: res.status, message: (typeof msg==='string'&&msg.length>200)?msg.slice(0,200):msg, result: shape(r, 0), hasProjects: Array.isArray(r?.projects), projectCount: Array.isArray(r?.projects) ? r.projects.length : null });
  }
  return out;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),30000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

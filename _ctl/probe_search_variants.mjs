const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(async () => {
  const out = [];
  const cases = [
    { label: 'GET raw toolName', method: 'GET', body: null, input: { toolName: 'PINHOLE' } },
    { label: 'GET raw toolName+cursor', method: 'GET', body: null, input: { toolName: 'PINHOLE', cursor: '' } },
    { label: 'POST wrap', method: 'POST', body: { json: { toolName: 'PINHOLE' } }, input: null },
    { label: 'POST raw', method: 'POST', body: { toolName: 'PINHOLE' }, input: null },
  ];
  for (const c of cases) {
    let url = 'https://labs.google/fx/api/trpc/project.searchUserProjects';
    if (c.input) url += '?input=' + encodeURIComponent(JSON.stringify(c.input));
    try {
      const opts = { method: c.method, credentials: 'include', headers: { 'Accept': 'application/json' } };
      if (c.body !== null) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(c.body); }
      const res = await fetch(url, opts);
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      const r = json?.result?.data?.json?.result;
      out.push({ label: c.label, httpStatus: res.status, err: json?.error?.json?.code || null, msg: (json?.error?.json?.message||'').slice(0,90), resultKeys: r && typeof r==='object' ? Object.keys(r) : null, projectCount: Array.isArray(r?.projects) ? r.projects.length : null });
    } catch (e) { out.push({ label: c.label, error: String(e) }); }
  }
  return out;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),30000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

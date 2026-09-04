const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const inputs = [
  { json: { toolName: 'PINHOLE' } },
  { json: { toolName: 'PINHOLE', pageSize: 25 } },
  { json: { toolName: 'PINHOLE', cursor: '' } },
  { json: { toolName: 'PINHOLE', pageToken: '' } },
];
const expression = `(async () => {
  const inputs = ${JSON.stringify(inputs)};
  const out = [];
  for (const input of inputs) {
    const inputParam = encodeURIComponent(JSON.stringify(input));
    try {
      const res = await fetch('https://labs.google/fx/api/trpc/project.searchUserProjects?input=' + inputParam, {
        method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' },
      });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      // structural summary only
      const summary = (j) => {
        if (!j) return null;
        if (j.error) return { error: true, code: j.error?.json?.code, msg: (j.error?.json?.message||'').slice(0,120) };
        const r = j.result?.data?.json?.result;
        const hasProjects = r && typeof r === 'object' && 'projects' in r;
        return { ok: true, resultKeys: r && typeof r==='object' ? Object.keys(r) : [], projectCount: Array.isArray(r?.projects) ? r.projects.length : null, sample: Array.isArray(r?.projects) && r.projects[0] ? Object.keys(r.projects[0]) : null };
      };
      out.push({ input, httpStatus: res.status, summary: summary(json) });
    } catch (e) { out.push({ input, error: String(e) }); }
  }
  return out;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),30000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

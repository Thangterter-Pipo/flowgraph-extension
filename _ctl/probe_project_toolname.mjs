const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const tools = ['TOOL_NAME_UNSPECIFIED','MUSICLM_V2','TEXT_FX','IMAGE_FX','MUSIC_FX_LIVE','VIDEO_FX','VIDEO_FX_TT','IMAGE_FX_TT','ARCADE_FX_IMAGE_GENERATION','BACKBONE','VISUALIZER','STUDIO_FX','PINHOLE','ASSET_MANAGER','REUBEN','ASSET_MANAGER_WHISK','BOTTLE'];
const expression = `(async () => {
  const tools = ${JSON.stringify(tools)};
  const out = [];
  for (const toolName of tools) {
    const inputParam = encodeURIComponent(JSON.stringify({ json: { toolName } }));
    try {
      const res = await fetch('https://labs.google/fx/api/trpc/project.searchUserProjects?input=' + inputParam, {
        method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' },
      });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      const hasError = !!(json && json.error);
      const projects = json?.result?.data?.json?.result?.projects;
      const isEmpty = Array.isArray(projects) && projects.length === 0;
      out.push({ toolName, httpStatus: res.status, hasError, isEmpty, projectCount: Array.isArray(projects) ? projects.length : null });
    } catch (e) {
      out.push({ toolName, error: String(e) });
    }
  }
  return out;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),40000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

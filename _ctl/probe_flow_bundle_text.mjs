const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('labs.google/fx'));
if (!t) { console.error('FLOW_TAB_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(async () => {
  const out = [];
  const needles = ['searchUserProjects','listProjects','getProjects','toolName','project.search'];
  for (const needle of needles) {
    const hits = [];
    for (const script of Array.from(document.scripts)) {
      const src = script.src || '';
      if (!src) continue;
      try {
        const res = await fetch(src);
        const text = await res.text();
        let idx = 0;
        let found = 0;
        while ((idx = text.indexOf(needle, idx)) !== -1 && found < 5) {
          const start = Math.max(0, idx - 60);
          const end = Math.min(text.length, idx + needle.length + 80);
          hits.push({ src: src.slice(-70), snippet: text.slice(start, end).replace(/\\s+/g,' ') });
          idx += needle.length;
          found++;
        }
      } catch {}
    }
    out.push({ needle, count: hits.length, hits });
  }
  return out;
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),40000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

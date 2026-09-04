const pages = await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t = pages.find(x => (x.url||'').includes('chrome-extension://') && (x.url||'').includes('/studio.html'));
if (!t) { console.error('STUDIO_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
const expression = `(() => {
  const nodes = Array.from(document.querySelectorAll('.flow-node')).map(n => {
    const title = n.querySelector('.flow-node-title')?.innerText?.trim() || n.querySelector('.node-title-icon')?.parentElement?.innerText?.trim();
    const status = n.querySelector('.flow-node-status')?.innerText?.trim();
    const media = n.querySelector('.node-result-media');
    const img = n.querySelector('.node-result-media img');
    const video = n.querySelector('.node-result-media video');
    const empty = n.querySelector('.node-result-empty span')?.innerText?.trim();
    return {
      title,
      status,
      mediaType: media ? media.className.replace('node-result-media','').trim() : null,
      imgSrc: img ? img.getAttribute('src') : null,
      videoSrc: video ? video.getAttribute('src') : null,
      empty
    };
  });
  return { nodeCount: nodes.length, nodes };
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg = await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),15000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg,null,2));

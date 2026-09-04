const pages = await fetch('http://127.0.0.1:9224/json/list').then(r => r.json());
const t = pages.find(x => x.type === 'service_worker' && (x.url || '').includes('background/service-worker.js'));
if (!t) { console.error('SW_TARGET_NOT_FOUND'); process.exit(2); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
const mediaId = process.argv[2] || 'ad8c9e30-27be-400e-b811-ab3d69e6d153';
const expression = `(async()=>{ const mediaId=${JSON.stringify(mediaId)}; const url='https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name='+encodeURIComponent(mediaId); try { const id = await chrome.downloads.download({ url, saveAs:false, conflictAction:'uniquify' }); return { ok:true, downloadId:id, url }; } catch(e){ return { ok:false, error:String(e), url }; } })()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
const msg = await new Promise((resolve, reject) => {
  const tt = setTimeout(() => reject(new Error('timeout')), 15000);
  ws.addEventListener('message', ev => { const x = JSON.parse(ev.data); if (x.id === 1) { clearTimeout(tt); resolve(x); } });
});
ws.close();
console.log(JSON.stringify(msg.result?.result?.value ?? msg, null, 2));

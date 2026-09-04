const pages=await fetch('http://127.0.0.1:9224/json/list').then(r=>r.json());
const t=pages.find(x=>(x.url||'').startsWith('chrome://extensions'));
if(!t){console.error('EXTENSIONS_PAGE_NOT_FOUND');process.exit(2)}
const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true})});
const expression=`(() => {
 const mgr=document.querySelector('extensions-manager');
 const list=mgr?.shadowRoot?.querySelector('extensions-item-list');
 const items=list?.shadowRoot?.querySelectorAll('extensions-item') || [];
 return Array.from(items).map(item=>({id:item.getAttribute('id')||item.id,name:item.shadowRoot?.querySelector('#name')?.textContent?.trim()||'',source:item.shadowRoot?.querySelector('#source-indicator')?.textContent?.trim()||'',errors:item.shadowRoot?.querySelector('#errors-button')?.textContent?.trim()||''}));
})()`;
ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
const msg=await new Promise((resolve,reject)=>{const tt=setTimeout(()=>reject(new Error('timeout')),15000);ws.addEventListener('message',ev=>{const x=JSON.parse(ev.data);if(x.id===1){clearTimeout(tt);resolve(x)}})});ws.close();console.log(JSON.stringify(msg.result?.result?.value??msg,null,2));

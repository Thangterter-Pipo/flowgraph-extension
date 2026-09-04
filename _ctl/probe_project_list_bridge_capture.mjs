// Capture the production FLOWGRAPH_PROJECT_LIST path (Studio -> chrome.runtime.sendMessage)
// into sanitized evidence. Never writes tokens/cookies/authorization.
import fs from 'node:fs';
import path from 'node:path';

const pages = await fetch('http://127.0.0.1:9224/json/list').then((r) => r.json());
const studio = pages.find((x) => (x.url || '').includes('chrome-extension://doibgbebcgbecadimjcclbbhpaodijdp/studio.html'));
if (!studio) {
  console.error('STUDIO_NOT_FOUND');
  process.exit(2);
}

const ws = new WebSocket(studio.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

const expr = `(async()=>{
  const q=(type)=>new Promise((resolve)=>{
    const id=Math.random().toString(36).slice(2);
    chrome.runtime.sendMessage({type,requestId:id},(resp)=>{
      if(chrome.runtime.lastError) resolve({error:chrome.runtime.lastError.message});
      else resolve(resp);
    });
  });
  const list=await q('FLOWGRAPH_PROJECT_LIST');
  const account=await q('FLOWGRAPH_ACCOUNT_STATUS');
  const flow=await q('FLOWGRAPH_FLOW_STATUS');
  return { list, account, flow };
})()`;

ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
const m = await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('timeout')), 20000);
  ws.addEventListener('message', (e) => {
    const x = JSON.parse(e.data);
    if (x.id === 1) { clearTimeout(to); resolve(x); }
  });
});
ws.close();

const value = m.result?.result?.value ?? null;
if (!value?.list?.ok || !Array.isArray(value?.list?.data?.projects)) {
  console.error('BRIDGE_LIST_FAILED');
  process.exit(3);
}

const projects = value.list.data.projects.map((p) => ({
  projectId: p.projectId,
  projectTitle: p.projectTitle,
  creationTime: p.creationTime,
}));
const target = projects.find((p) => p.projectId === value.flow?.data?.projectId);

const capturedAt = new Date().toISOString();
const out = {
  capturedAt,
  source: 'runtime',
  bridgeMessage: 'FLOWGRAPH_PROJECT_LIST',
  transport: 'Studio -> chrome.runtime.sendMessage -> service-worker',
  httpStatus: 200,
  projectCount: projects.length,
  targetProject: target ?? null,
  projects,
  account: {
    state: value.account?.data?.state ?? null,
    email: value.account?.data?.email ?? null,
    name: value.account?.data?.name ?? null,
  },
  flow: {
    state: value.flow?.data?.state ?? null,
    projectId: value.flow?.data?.projectId ?? null,
  },
  noSecrets: true,
};

const dir = 'E:\\Flow_veo\\flowgraph-extension\\evidence\\flowgraph_v1\\projects';
fs.mkdirSync(dir, { recursive: true });
const safeStamp = capturedAt.replace(/[:.]/g, '-');
const file = path.join(dir, `project_list_bridge_${safeStamp}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ wrote: file, projectCount: out.projectCount, target: target?.projectId }, null, 2));

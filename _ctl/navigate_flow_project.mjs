const projectId = process.argv[2];
if (!projectId || !/^[a-zA-Z0-9-]+$/.test(projectId)) {
  console.error('USAGE: node navigate_flow_project.mjs <projectId>');
  process.exit(2);
}
const pages = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = pages.find((candidate) => candidate.type === 'page' && /\/tools\/flow\/project\//.test(candidate.url || ''))
  ?? pages.find((candidate) => candidate.type === 'page' && /labs\.google\/fx\/.+\/tools\/flow(?:$|[?#])/.test(candidate.url || ''));
if (!target) {
  console.error('FLOW_TAB_NOT_FOUND');
  process.exit(2);
}
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const url = `https://labs.google/fx/vi/tools/flow/project/${projectId}`;
socket.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('PAGE_NAVIGATE_TIMEOUT')), 8_000);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    resolve();
  });
});
socket.close();
console.log(JSON.stringify({ ok: true, projectId }));

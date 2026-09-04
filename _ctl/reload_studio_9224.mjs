const pages = await fetch('http://127.0.0.1:9224/json/list').then((response) => response.json());
const target = pages.find((candidate) => candidate.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(candidate.url || ''));
if (!target) {
  console.error('STUDIO_NOT_FOUND');
  process.exit(2);
}
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.send(JSON.stringify({ id: 1, method: 'Page.reload', params: { ignoreCache: true } }));
await new Promise((resolve) => {
  const timeout = setTimeout(resolve, 5_000);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    setTimeout(resolve, 2_500);
  });
});
socket.close();
console.log(JSON.stringify({ ok: true, reloaded: true }));

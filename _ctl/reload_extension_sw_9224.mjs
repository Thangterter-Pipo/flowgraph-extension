const endpoint = 'http://127.0.0.1:9224';
const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const studio = pages.find((target) => target.type === 'page' && /chrome-extension:\/\/[^/]+\/studio\.html$/.test(target.url || ''));
if (!studio) {
  console.error('STUDIO_NOT_FOUND');
  process.exit(2);
}
const extensionId = new URL(studio.url).host;
const socket = new WebSocket(studio.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.send(JSON.stringify({
  id: 1,
  method: 'Runtime.evaluate',
  params: {
    expression: 'setTimeout(() => chrome.runtime.reload(), 50); "RELOAD_TRIGGERED"',
    returnByValue: true,
  },
}));
await new Promise((resolve) => {
  const timeout = setTimeout(resolve, 1_000);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    resolve();
  });
});
socket.close();
await new Promise((resolve) => setTimeout(resolve, 1_250));
const refreshed = await fetch(`${endpoint}/json/list`).then((response) => response.json());
if (!refreshed.some((target) => target.type === 'page' && target.url === `chrome-extension://${extensionId}/studio.html`)) {
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(`chrome-extension://${extensionId}/studio.html`)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`OPEN_STUDIO_FAILED_${response.status}`);
}
console.log(JSON.stringify({ ok: true, reloaded: true, studioReopened: true }));

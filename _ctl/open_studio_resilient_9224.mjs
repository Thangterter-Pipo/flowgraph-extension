const endpoint = 'http://127.0.0.1:9224';
const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const extensionTarget = pages.find((target) => target.type === 'page' && /^chrome-extension:\/\/[^/]+\//.test(target.url || ''));
if (!extensionTarget) {
  console.error('FLOWGRAPH_EXTENSION_TARGET_NOT_FOUND');
  process.exit(2);
}
const extensionId = new URL(extensionTarget.url).host;
const studioUrl = `chrome-extension://${extensionId}/studio.html`;
if (!pages.some((target) => target.type === 'page' && target.url === studioUrl)) {
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(studioUrl)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`OPEN_STUDIO_FAILED_${response.status}`);
}
console.log(JSON.stringify({ ok: true, studioUrl: '/studio.html' }));

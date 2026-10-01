const opening = new Map<string, Promise<void>>();

export function studioUrl(): string {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) throw new Error('Cần mở Sidepanel trong tiện ích Chrome.');
  return chrome.runtime.getURL('studio.html');
}

export async function studioIsOpen(): Promise<boolean> {
  const url = studioUrl();
  if (!chrome.windows?.getAll) {
    return (await chrome.tabs.query({})).some((tab) => tab.url === url || tab.pendingUrl === url);
  }
  const windows = await chrome.windows.getAll({ populate: true });
  return windows.some((window) => window.type === 'popup'
    && window.tabs?.some((tab) => tab.url === url || tab.pendingUrl === url));
}

function focusOrOpen(url: string, matches: (url: string) => boolean): Promise<void> {
  const pending = opening.get(url);
  if (pending) return pending;
  const work = (async () => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) throw new Error('Không truy cập được thẻ Chrome.');
    const tab = (await chrome.tabs.query({})).find((candidate) => candidate.id !== undefined
      && (matches(candidate.url ?? '') || matches(candidate.pendingUrl ?? '')));
    if (tab?.id !== undefined) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    } else {
      await chrome.tabs.create({ url });
    }
  })().finally(() => { opening.delete(url); });
  opening.set(url, work);
  return work;
}

export function openStudio(): Promise<void> {
  const url = studioUrl();
  const pending = opening.get(url);
  if (pending) return pending;
  const work = (async () => {
    if (typeof chrome === 'undefined' || !chrome.windows?.getAll || !chrome.windows?.create) {
      const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url || candidate.pendingUrl === url);
      if (tab?.id !== undefined) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined && chrome.windows?.update) {
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
      } else await chrome.tabs.create({ url });
      return;
    }
    const windows = await chrome.windows.getAll({ populate: true });
    const existing = windows.find((window) => window.type === 'popup'
      && window.tabs?.some((tab) => tab.url === url || tab.pendingUrl === url));
    if (existing?.id !== undefined) {
      await chrome.windows.update(existing.id, { focused: true, state: 'normal' });
      return;
    }
    await chrome.windows.create({
      url,
      type: 'popup',
      width: 1440,
      height: 920,
      focused: true,
    });
  })().finally(() => { opening.delete(url); });
  opening.set(url, work);
  return work;
}

export function openFlow(): Promise<void> {
  return focusOrOpen('https://flow.google.com', (candidate) => {
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && (url.hostname === 'flow.google.com'
        || (url.hostname === 'labs.google' && /^\/fx(?:\/|$)/.test(url.pathname)));
    } catch { return false; }
  });
}

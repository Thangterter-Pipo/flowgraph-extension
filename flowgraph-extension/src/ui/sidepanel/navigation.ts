const opening = new Map<string, Promise<void>>();

export function studioUrl(projectId?: string, title?: string): string {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) throw new Error('Cần mở Sidepanel trong tiện ích Chrome.');
  const base = chrome.runtime.getURL('studio.html');
  if (projectId) {
    const params = new URLSearchParams();
    params.set('projectId', projectId);
    if (title) params.set('title', title);
    return `${base}?${params.toString()}`;
  }
  return base;
}

export function isStudioUrl(candidate: string, baseUrl?: string): boolean {
  try {
    const base = baseUrl ?? (typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('studio.html') : 'studio.html');
    if (candidate === base) return true;
    if (candidate.startsWith(base + '?') || candidate.startsWith(base + '#')) return true;
    return false;
  } catch {
    return false;
  }
}

export async function studioIsOpen(): Promise<boolean> {
  const base = studioUrl();
  if (!chrome.windows?.getAll) {
    return (await chrome.tabs.query({})).some((tab) => isStudioUrl(tab.url ?? '', base) || isStudioUrl(tab.pendingUrl ?? '', base));
  }
  const windows = await chrome.windows.getAll({ populate: true });
  return windows.some((window) => window.type === 'popup'
    && window.tabs?.some((tab) => isStudioUrl(tab.url ?? '', base) || isStudioUrl(tab.pendingUrl ?? '', base)));
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

export function openStudio(projectId?: string, title?: string): Promise<void> {
  const url = studioUrl(projectId, title);
  const base = studioUrl();
  const pending = opening.get(base);
  if (pending) return pending;
  const work = (async () => {
    if (projectId && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('flowgraph.activeProject', JSON.stringify({
          projectId,
          projectName: title || 'Flow Project',
          selectedAt: new Date().toISOString(),
        }));
      } catch {}
    }

    if (typeof chrome === 'undefined' || !chrome.windows?.getAll || !chrome.windows?.create) {
      const tab = (await chrome.tabs.query({})).find((candidate) => isStudioUrl(candidate.url ?? '', base) || isStudioUrl(candidate.pendingUrl ?? '', base));
      if (tab?.id !== undefined) {
        const updateParams: { active: boolean; url?: string } = { active: true };
        if (projectId) updateParams.url = url;
        await chrome.tabs.update(tab.id, updateParams);
        if (tab.windowId !== undefined && chrome.windows?.update) {
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
      } else await chrome.tabs.create({ url });
      return;
    }
    const windows = await chrome.windows.getAll({ populate: true });
    const existing = windows.find((window) => window.type === 'popup'
      && window.tabs?.some((tab) => isStudioUrl(tab.url ?? '', base) || isStudioUrl(tab.pendingUrl ?? '', base)));
    if (existing?.id !== undefined) {
      const existingTab = existing.tabs?.find((tab) => isStudioUrl(tab.url ?? '', base) || isStudioUrl(tab.pendingUrl ?? '', base));
      if (existingTab?.id !== undefined && projectId) {
        await chrome.tabs.update(existingTab.id, { url });
      }
      await chrome.windows.update(existing.id, { focused: true, state: 'normal' });
      return;
    }

    const regularTab = (await chrome.tabs.query({})).find((candidate) => isStudioUrl(candidate.url ?? '', base) || isStudioUrl(candidate.pendingUrl ?? '', base));
    if (regularTab?.id !== undefined) {
      const updateParams: { active: boolean; url?: string } = { active: true };
      if (projectId) updateParams.url = url;
      await chrome.tabs.update(regularTab.id, updateParams);
      if (regularTab.windowId !== undefined && chrome.windows?.update) {
        await chrome.windows.update(regularTab.windowId, { focused: true }).catch(() => {});
      }
      return;
    }

    await chrome.windows.create({
      url,
      type: 'popup',
      width: 1440,
      height: 920,
      focused: true,
    });
  })().finally(() => { opening.delete(base); });
  opening.set(base, work);
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

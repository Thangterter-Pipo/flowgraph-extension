import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStudio, studioIsOpen, openFlow } from '../../src/ui/sidepanel/navigation';
const url = 'chrome-extension://ours/studio.html';
function browser(tabs: object[] = []) {
  const api = { runtime: { getURL: () => url }, tabs: {
    query: vi.fn().mockResolvedValue(tabs), update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  }, windows: { update: vi.fn().mockResolvedValue({}) } };
  vi.stubGlobal('chrome', api);
  return api;
}
afterEach(() => vi.unstubAllGlobals());
describe('Sidepanel navigation', () => {
  it('focuses exact Studio URL, not other extensions or lookalikes', async () => {
    const api = browser([{ id: 1, url: url + '.bad' }, { id: 2, url: 'chrome-extension://other/studio.html' }, { id: 3, windowId: 0, url }]);
    await openStudio();
    expect(api.tabs.update).toHaveBeenCalledWith(3, { active: true });
    expect(api.windows.update).toHaveBeenCalledWith(0, { focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(await studioIsOpen()).toBe(true);
  });
  it('coalesces double clicks and does not duplicate after focus failure', async () => {
    const api = browser();
    await Promise.all([openStudio(), openStudio(), openStudio()]);
    expect(api.tabs.create).toHaveBeenCalledTimes(1);
    api.tabs.query.mockResolvedValue([{ id: 1, windowId: 2, url }]);
    api.windows.update.mockRejectedValue(new Error('focus denied'));
    await openStudio();
    expect(api.tabs.create).toHaveBeenCalledTimes(1);
  });
  it('surfaces Chrome failures without opening a duplicate fallback', async () => {
    const api = browser();
    api.tabs.create.mockRejectedValue(new Error('denied'));
    await expect(openStudio()).rejects.toThrow('denied');
  });
  it('matches Flow hosts securely', async () => {
    const api = browser([{ id: 1, url: 'https://evil.test/flow.google.com' }]);
    await openFlow();
    expect(api.tabs.create).toHaveBeenCalledWith({ url: 'https://flow.google.com' });
  });
});

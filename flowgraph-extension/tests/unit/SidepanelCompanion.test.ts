import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFlow } from '../../src/ui/sidepanel/navigation';

afterEach(() => vi.unstubAllGlobals());

function browser(tabs: object[]) {
  return {
    tabs: { query: vi.fn().mockResolvedValue(tabs), update: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}) },
    windows: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe('Companion tab navigation', () => {
  it.each(['https://labs.google/fx/tools/flow/project/abc', 'https://flow.google.com/project/abc'])(
    'activates an existing Flow tab: %s', async (url) => {
      const chrome = browser([{ id: 7, windowId: 0, url }]);
      vi.stubGlobal('chrome', chrome);
      await openFlow();
      expect(chrome.tabs.query).toHaveBeenCalledWith({});
      expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
      expect(chrome.windows.update).toHaveBeenCalledWith(0, { focused: true });
      expect(chrome.tabs.create).not.toHaveBeenCalled();
    },
  );
  it('creates a tab only when no usable Flow tab exists', async () => {
    const chrome = browser([{ id: 2, url: 'https://example.com' }]);
    vi.stubGlobal('chrome', chrome);
    await openFlow();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://flow.google.com' });
  });
  it('reports missing Chrome APIs instead of pretending preview is connected', async () => {
    vi.stubGlobal('chrome', undefined);
    await expect(openFlow()).rejects.toThrow('Không truy cập được thẻ Chrome.');
  });
});

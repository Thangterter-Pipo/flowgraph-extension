import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(resolve(__dirname, '../../src/background/service-worker.ts'), 'utf8');
function workerFunction(name: string, globals: Record<string, unknown> = {}) {
  const ast = ts.createSourceFile('worker.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)!;
  const code = ts.transpile(declaration.getText(ast), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return runInNewContext(`${code}; ${name}`, { URL, ...globals });
}
const bridgeError = (code: string, message: string) => Object.assign(new Error(message), { code });
const unwrapTrpc = workerFunction('unwrapTrpc');

describe('project list legacy failures', () => {
  it('rejects HTTP 401 even with a JSON error envelope without exposing provider text', async () => {
    const get = workerFunction('fxApiGet', {
      ensureSession: async () => ({}), timeoutable: (p: unknown) => p,
      FX_API_BASE: 'https://labs.google/fx/api', REQUEST_TIMEOUT_MS: 100,
      fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { json: { message: 'SECRET' } } }) }),
      providerError: workerFunction('providerError', { bridgeError, session: null }),
    });
    await expect(get('test')).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
  });
  it.each([null, {}, { error: { json: {} } }, { result: { data: { json: { result: {} } } } }])(
    'rejects malformed legacy envelope %j instead of claiming empty', async json => {
      const list = workerFunction('handleLegacyProjectList', {
        chrome: { tabs: { query: async () => [{ id: 1, url: 'https://labs.google/fx/tools/flow' }] } },
        bridgeError, unwrapTrpc, fxApiGet: async () => json,
      });
      await expect(list()).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });
});
describe('live Flow project listing', () => {
  const ids = Array.from({ length: 5 }, (_, i) => `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee${i}`);
  const url = 'https://flow.google.com/';
  function reader(hrefs: string[], page = url) {
    return workerFunction('readFlowProjectCards', {
      location: { href: page },
      document: { querySelectorAll: vi.fn((selector: string) => {
        expect(selector).toBe('a.project-thumbnail-container[href]');
        return hrefs.map((href, i) => ({ getAttribute: () => href,
          closest: () => ({ innerText: `Tháng 9 ${i}\nedit\ndelete` }) }));
      }) },
    });
  }
  it('reads five card titles, deduplicates UUIDs and rejects untrusted URLs', () => {
    const read = reader([...ids.map(id => `/project/${id}`), `/project/${ids[0].toUpperCase()}`,
      `https://evil.test/project/${ids[0]}`, '/project/not-uuid',
      `https://flow.google.com.evil.test/project/${ids[0]}`, `http://flow.google.com/project/${ids[0]}`,
      `https://user@flow.google.com/project/${ids[0]}`, `/project/${ids[0]}/extra`]);
    const data = read(url);
    expect(data.source).toBe('flow-dom');
    expect(data.partial).toBe(true);
    expect(data.projects).toEqual(ids.map((projectId, i) => ({ projectId, projectTitle: `Tháng 9 ${i}` })));
    expect(JSON.stringify(data)).not.toMatch(/edit|delete/);
  });
  it('does not call an empty/loading or project page an empty account', () => {
    expect(reader([])(url).error).toContain('danh sách');
    const projectUrl = `${url}project/${ids[0]}`;
    expect(reader([], projectUrl)(projectUrl).error).toContain('danh sách');
    expect(reader([], 'https://evil.test/')(url).error).toBeDefined();
  });
  it('uses one isolated read without API/session calls', async () => {
    const executeScript = vi.fn().mockResolvedValue([{ result: { projects: [{ projectId: ids[0], projectTitle: 'A' }], source: 'flow-dom', partial: true } }]);
    const fxApiGet = vi.fn();
    const list = workerFunction('handleProjectList', {
      chrome: { tabs: { query: async () => [{ id: 9, url }], get: async () => ({ url }) }, scripting: { executeScript } },
      readFlowProjectCards: reader([]), bridgeError, fxApiGet, unwrapTrpc,
      timeoutable: (p: unknown) => p, REQUEST_TIMEOUT_MS: 100,
    });
    expect((await list()).projects).toHaveLength(1);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 9 }, world: 'ISOLATED', args: [url] }));
    expect(fxApiGet).not.toHaveBeenCalled();
  });
  it('refuses to combine or guess between tabs', async () => {
    const executeScript = vi.fn();
    const list = workerFunction('handleProjectList', {
      chrome: { tabs: { query: async () => [{ id: 1, url }, { id: 2, url }] }, scripting: { executeScript } }, bridgeError,
    });
    await expect(list()).rejects.toMatchObject({ code: 'PROJECT_LIST_UNAVAILABLE' });
    expect(executeScript).not.toHaveBeenCalled();
  });
  it.each(['closed', 'navigated', 'no-result', 'injection-error'])('fails closed when the selected tab is %s', async mode => {
    const list = workerFunction('handleProjectList', {
      chrome: { tabs: { query: async () => [{ id: 9, url }], get: async () => {
        if (mode === 'closed') throw new Error('closed');
        return { url: mode === 'navigated' ? `${url}project/${ids[0]}` : url };
      } }, scripting: { executeScript: async () => {
        if (mode === 'injection-error') throw new Error('private browser error');
        return mode === 'no-result' ? [] : [{ result: { projects: [{ projectId: ids[0], projectTitle: 'A' }], source: 'flow-dom', partial: true } }];
      } } }, readFlowProjectCards: reader([]), bridgeError, timeoutable: (p: unknown) => p, REQUEST_TIMEOUT_MS: 100,
    });
    await expect(list()).rejects.toMatchObject({ code: 'PROJECT_LIST_UNAVAILABLE' });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

describe('developer diagnostics', () => {
  it('targets the private listener and grants matching manifest permission', async () => {
    const { createDiagnostics } = await import('../../src/shared/devDiagnostics');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const log = createDiagnostics('studio', '0.1.0', fetcher);
    log.setEnabled(true);
    log.report('RPC_FAILED');
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:3081/dev-errors');
    for (const file of ['../manifest.json', 'public/manifest.json']) {
      expect(JSON.parse(readFileSync(file, 'utf8')).host_permissions).toContain('http://127.0.0.1:3081/*');
    }
    log.setEnabled(false);
  });
  it('renders honest disabled state without claiming listener delivery', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DeveloperModeToggle } = await import('../../src/ui/components/DeveloperModeToggle');
    const html = renderToStaticMarkup(React.createElement(DeveloperModeToggle));
    expect(html).not.toContain(':3080');
    expect(html).toContain('127.0.0.1:3081');
    expect(html).toContain('chưa xác nhận');
    expect(html).toContain('Đang tắt');
    expect(html).toContain('disabled');
    expect(html).not.toContain('checked');
  });
  it.each([403, 429, 503, 'offline'])('handles transport failure %s without recursion', async (status) => {
    vi.useFakeTimers();
    const { createDiagnostics } = await import('../../src/shared/devDiagnostics');
    const fetcher = status === 'offline' ? vi.fn().mockRejectedValue(new Error('offline'))
      : vi.fn().mockResolvedValue({ ok: false, status });
    const log = createDiagnostics('studio', '0.1.0', fetcher);
    log.setEnabled(true);
    log.report('RPC_FAILED');
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(status === 503 || status === 'offline' ? 2 : 1);
    log.setEnabled(false);
    log.report('WORKFLOW_FAILED');
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(status === 503 || status === 'offline' ? 2 : 1);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('loads false by default and reacts to storage changes in owned contexts only', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    let listener: (changes: Record<string, { newValue: boolean }>, area: string) => void = () => {};
    const events = new Map<string, () => void>();
    const get = vi.fn().mockResolvedValue({});
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('chrome', { runtime: { id: 'a'.repeat(32), getManifest: () => ({ version: '0.1.0' }) },
      storage: { local: { get }, onChanged: { addListener: (fn: typeof listener) => { listener = fn; } } } });
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('addEventListener', (name: string, fn: () => void) => events.set(name, fn));
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'example.com' });
    const { installDiagnostics, DEVELOPER_MODE_KEY } = await import('../../src/shared/devDiagnostics');
    installDiagnostics('studio');
    expect(get).not.toHaveBeenCalled();
    vi.stubGlobal('location', { protocol: 'chrome-extension:', hostname: 'a'.repeat(32) });
    installDiagnostics('studio');
    await vi.runAllTimersAsync();
    events.get('error')!();
    expect(fetcher).not.toHaveBeenCalled();
    listener({ [DEVELOPER_MODE_KEY]: { newValue: true } }, 'local');
    events.get('unhandledrejection')!();
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    listener({ [DEVELOPER_MODE_KEY]: { newValue: false } }, 'local');
    events.get('error')!();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds unavailable transport and drops pending work on opt-out', async () => {
    const { createDiagnostics } = await import('../../src/shared/devDiagnostics');
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const log = createDiagnostics('studio', '0.1.0', fetcher);
    log.setEnabled(true);
    for (let i = 0; i < 100; i++) log.report('RPC_FAILED');
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(2);
    log.report('WORKFLOW_FAILED');
    log.report('UNCAUGHT_ERROR');
    log.setEnabled(false);
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]).toBeDefined();
  });

  it('wires owned entrypoints, RPC/workflow failures and an accessible separate opt-in', () => {
    for (const file of ['src/ui/studio/main.tsx', 'src/ui/sidepanel/main.tsx', 'src/background/service-worker.ts']) {
      expect(readFileSync(file, 'utf8')).toContain('installDiagnostics(');
    }
    expect(readFileSync('src/shared/bridge.ts', 'utf8')).toContain("reportDiagnostic('RPC_FAILED')");
    expect(readFileSync('src/runtime/WorkflowRuntime.ts', 'utf8')).toContain("reportDiagnostic('WORKFLOW_FAILED')");
    expect(readFileSync('src/ui/studio/SettingsModal.tsx', 'utf8')).toContain('<DeveloperModeToggle');
    expect(existsSync('src/ui/components/DeveloperModeToggle.tsx')).toBe(true);
  });
  it('is opt-in, dedupes and never forwards arbitrary error text', async () => {
    expect(existsSync('src/shared/devDiagnostics.ts')).toBe(true);
    const { createDiagnostics } = await import('../../src/shared/devDiagnostics');
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const log = createDiagnostics('studio', '0.1.0', fetcher);
    log.report('RPC_FAILED');
    await vi.runAllTimersAsync();
    expect(fetcher).not.toHaveBeenCalled();
    log.setEnabled(true);
    const error = new Error('SENTINEL token cookie person@example.com prompt response');
    error.stack = 'Error: SENTINEL\n at SENTINEL (chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/main.js?token=SENTINEL#cookie:12:34)';
    log.report('RPC_FAILED', error);
    log.report('RPC_FAILED', error);
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = fetcher.mock.calls[0][1].body;
    expect(body).not.toMatch(/SENTINEL|person@|token|cookie|prompt|response/);
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['time', 'source', 'version', 'code', 'message', 'stack'].sort());
    expect(JSON.parse(body).message).toBe('Extension RPC failed');
    log.setEnabled(false);
    log.report('WORKFLOW_FAILED');
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// No console/content-script capture. Arbitrary errors are deliberately discarded.
export const DEVELOPER_MODE_KEY = 'flowgraph.developerMode.v1';
const ENDPOINT = 'http://127.0.0.1:3081/dev-errors';
const MESSAGES = {
  UNCAUGHT_ERROR: 'Uncaught extension error',
  UNHANDLED_REJECTION: 'Unhandled extension rejection',
  RPC_FAILED: 'Extension RPC failed',
  WORKFLOW_FAILED: 'Workflow execution failed',
  DEVLOG_SELF_TEST: 'Developer logging integration self-test',
} as const;
type Code = keyof typeof MESSAGES;
type Source = 'studio' | 'sidepanel' | 'service-worker';

export function createDiagnostics(source: Source, version: string, send: typeof fetch = (...args) => fetch(...args)) {
  let enabled = false;
  let running = false;
  let epoch = 0;
  let windowStart = 0;
  let count = 0;
  let active: AbortController | undefined;
  const queue: string[] = [];
  const seen = new Map<string, number>();

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (enabled && queue.length) {
        const body = queue.shift()!;
        const generation = epoch;
        for (let attempt = 0; attempt < 2 && enabled && generation === epoch; attempt++) {
          const controller = new AbortController();
          active = controller;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 1500);
            });
            const response = await Promise.race([send(ENDPOINT, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
              signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
            }), timeout]);
            if (response.ok || response.status < 500) break;
          } catch { /* Never report transport errors back into this logger. */ }
          finally { clearTimeout(timer); active = undefined; }
        }
      }
    } finally { running = false; }
  }

  return {
    setEnabled(value: boolean) {
      enabled = value === true;
      if (!enabled) { epoch++; queue.length = 0; seen.clear(); active?.abort(); }
    },
    report(code: Code, _discardedError?: unknown) {
      if (!enabled || !Object.hasOwn(MESSAGES, code)) return;
      const now = Date.now();
      if (now - windowStart >= 60_000) { windowStart = now; count = 0; }
      for (const [key, time] of seen) if (now - time >= 10_000) seen.delete(key);
      // Capture the diagnostic callsite, not an attacker-controlled error stack.
      // Keep only numeric locations in our extension. No URLs or function names.
      const id = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined;
      const stack = id ? (new Error().stack ?? '').split('\n').slice(1, 9).flatMap((line) => {
        if (!line.includes(`chrome-extension://${id}/`)) return [];
        const match = line.match(/:(\d{1,7}):(\d{1,7})\)?$/);
        return match ? [`extension:${match[1]}:${match[2]}`] : [];
      }).join('\n') : '';
      const key = `${code}:${stack}`;
      if (seen.has(key) || count >= 20 || queue.length >= 16) return;
      const body = JSON.stringify({ time: new Date(now).toISOString(), source,
        version: /^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(version) ? version : '0.0.0',
        code, message: MESSAGES[code], stack });
      if (new TextEncoder().encode(body).length > 4096) return;
      seen.set(key, now);
      count++;
      queue.push(body);
      void drain();
    },
  };
}

let installed: ReturnType<typeof createDiagnostics> | undefined;
export function reportDiagnostic(code: Code): void { installed?.report(code); }

export function installDiagnostics(source: Source): void {
  // This gate excludes Vite previews, website content scripts and foreign pages.
  if (installed || typeof chrome === 'undefined' || !chrome.runtime?.id
      || globalThis.location?.protocol !== 'chrome-extension:'
      || globalThis.location.hostname !== chrome.runtime.id || !chrome.storage?.local) return;
  const logger = createDiagnostics(source, chrome.runtime.getManifest().version);
  installed = logger;
  let changed = false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && DEVELOPER_MODE_KEY in changes) {
      changed = true;
      logger.setEnabled(changes[DEVELOPER_MODE_KEY].newValue === true);
    }
  });
  void chrome.storage.local.get(DEVELOPER_MODE_KEY).then((data) => {
    if (!changed) logger.setEnabled(data[DEVELOPER_MODE_KEY] === true);
  }).catch(() => {});
  globalThis.addEventListener('error', () => logger.report('UNCAUGHT_ERROR'));
  globalThis.addEventListener('unhandledrejection', () => logger.report('UNHANDLED_REJECTION'));
}

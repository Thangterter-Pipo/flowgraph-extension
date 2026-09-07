// Bundles the TS service worker + content bridge into public/ so vite copies them to dist/.
// The service worker is compiled from src/background/service-worker.ts with esbuild
// (imports of ../shared/bridge are bundled in — MV3 workers must be self-contained).
// The content script is plain JS in public/content/ (no build needed) but is copied
// verbatim; this script ensures dist/background + dist/content stay in sync.

import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  // 1. Bundle service worker (ESM, target chrome 110+)
  await build({
    entryPoints: [resolve(root, 'src/background/service-worker.ts')],
    outfile: resolve(root, 'public/background/service-worker.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome110',
    sourcemap: false,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  // 2. Content script is authored directly in public/content — ensure dist copy is fresh.
  mkdirSync(resolve(root, 'dist/content'), { recursive: true });
  mkdirSync(resolve(root, 'dist/background'), { recursive: true });
  cpSync(resolve(root, 'public/content/flow-content-script.js'), resolve(root, 'dist/content/flow-content-script.js'));
  cpSync(resolve(root, 'public/background/service-worker.js'), resolve(root, 'dist/background/service-worker.js'));

  console.log('[build:bridge] service-worker.js + flow-content-script.js ready');
}

main().catch((error) => {
  console.error('[build:bridge] failed:', error);
  process.exit(1);
});

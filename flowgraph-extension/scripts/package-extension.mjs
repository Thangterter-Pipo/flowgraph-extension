// Packaging Pipeline for FlowGraph Chrome Extension
// Creates a release-ready ZIP bundle directly from dist/ for distribution or Chrome Web Store.

import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const pkgDir = resolve(root, 'packages');
const pkgJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkgJson.version || '0.1.0';

async function createZipBundle() {
  mkdirSync(pkgDir, { recursive: true });
  const zipName = `flowgraph-extension-v${version}.zip`;
  const zipPath = resolve(pkgDir, zipName);

  console.log(`[package] 📦 Packaging dist/ into ${zipName}...`);

  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => {
      const sizeMb = (archive.pointer() / (1024 * 1024)).toFixed(2);
      console.log(`[package] 🚀 Release package ready:`);
      console.log(`[package]    Path: ${zipPath}`);
      console.log(`[package]    Size: ${sizeMb} MB (${archive.pointer().toLocaleString()} bytes)`);
      resolvePromise(zipPath);
    });

    archive.on('error', (err) => reject(err));
    archive.pipe(output);

    // Append everything in dist/ to the root of the ZIP
    archive.directory(distDir, false);
    archive.finalize();
  });
}

async function main() {
  if (!existsSync(distDir)) {
    console.error('[package] Error: dist/ directory does not exist. Run "npm run build" first.');
    process.exit(1);
  }

  await createZipBundle();
}

main().catch((err) => {
  console.error('[package] Fatal packaging error:', err);
  process.exit(1);
});

// Packaging & Obfuscation Pipeline for FlowGraph Chrome Extension
// Scrambles and obfuscates all client JavaScript (Studio, Sidepanel, Service Worker, Content Script)
// and creates a release-ready ZIP bundle for Chrome Web Store (Unlisted/Private) or distribution.

import JavaScriptObfuscator from 'javascript-obfuscator';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const pkgDir = resolve(root, 'packages');
const pkgJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkgJson.version || '0.1.0';

// Recursively find all .js files in a directory
function findJsFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function obfuscateDist() {
  console.log('[package] 🛡️  Starting deep obfuscation on production bundle...');
  const jsFiles = findJsFiles(distDir);
  console.log(`[package] Found ${jsFiles.length} JavaScript files to protect.`);

  let totalOriginalSize = 0;
  let totalObfuscatedSize = 0;

  for (const file of jsFiles) {
    const relative = file.replace(distDir, '');
    const code = readFileSync(file, 'utf8');
    totalOriginalSize += code.length;

    // Apply robust, MV3-compatible obfuscation
    const obfuscated = JavaScriptObfuscator.obfuscate(code, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: true,
      identifierNamesGenerator: 'hexadecimal',
      numbersToExpressions: true,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 8,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.8,
      transformObjectKeys: true,
      target: 'browser',
    });

    const obfuscatedCode = obfuscated.getObfuscatedCode();
    totalObfuscatedSize += obfuscatedCode.length;
    writeFileSync(file, obfuscatedCode, 'utf8');
    console.log(`[package]   ✓ Protected: ${relative}`);
  }

  console.log(`[package] 🔒 Obfuscation complete!`);
  console.log(`[package]    Original JS: ${(totalOriginalSize / 1024).toFixed(1)} KB`);
  console.log(`[package]    Protected JS: ${(totalObfuscatedSize / 1024).toFixed(1)} KB`);
}

async function createZipBundle() {
  mkdirSync(pkgDir, { recursive: true });
  const zipName = `flowgraph-extension-v${version}-protected.zip`;
  const zipPath = resolve(pkgDir, zipName);

  console.log(`[package] 📦 Compressing extension into ${zipName}...`);

  return new Promise((resolvePromise, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => {
      const sizeMb = (archive.pointer() / (1024 * 1024)).toFixed(2);
      console.log(`[package] 🚀 SUCCESS! Release package ready:`);
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

  await obfuscateDist();
  await createZipBundle();
}

main().catch((err) => {
  console.error('[package] Fatal packaging error:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Builds `www/` from the checked-in `webapp/` source and injects the iOS
 * bridge. `www/` is the only web directory Capacitor copies into the app.
 *
 * Run with: npm run sync:web (or npm run sync:ios to also update Xcode).
 */
import { access, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'webapp');
const outputDir = path.join(root, 'www');
const bridgeFile = path.join(root, 'native', 'ios-shell.js');
const requiredSourceFiles = [
  'index.html',
  'styles.css',
  'core.js',
  'lab-tests.js',
  'clinical-tools.js',
  'app.js',
  'manifest.webmanifest',
  'service-worker.js',
  'assets/red-crescent-rx-96.png'
];

async function ensureFile(file, label) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error('empty');
  } catch (_) {
    throw new Error(`Missing ${label}: ${path.relative(root, file)}`);
  }
}

async function main() {
  for (const relative of requiredSourceFiles) {
    await ensureFile(path.join(sourceDir, relative), 'web source file');
  }
  await ensureFile(bridgeFile, 'native bridge');

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(sourceDir, outputDir, {
    recursive: true,
    filter: sourcePath => !/(^|[\\/])(\.DS_Store|Thumbs\.db)$/.test(sourcePath)
  });

  await cp(bridgeFile, path.join(outputDir, 'ios-shell.js'));

  const indexPath = path.join(outputDir, 'index.html');
  let html = await readFile(indexPath, 'utf8');

  const shellTag = '<script src="ios-shell.js?v=103"></script>';
  if (!html.includes(shellTag)) {
    const firstCoreScript = '<script src="core.js';
    if (!html.includes(firstCoreScript)) {
      throw new Error('index.html does not contain the core.js script tag');
    }
    html = html.replace(firstCoreScript, `${shellTag}\n  ${firstCoreScript}`);
  }

  // Service workers only run on http(s); the native shells use custom URL
  // schemes and bundle every asset, so the worker is unnecessary there.
  if (!html.includes("/^https?:$/.test(location.protocol)")) {
    throw new Error('Could not find the service worker registration guard');
  }

  await writeFile(indexPath, html, 'utf8');

  const indexInfo = await stat(indexPath);
  const bridgeInfo = await stat(path.join(outputDir, 'ios-shell.js'));
  await access(path.join(outputDir, 'assets'));
  console.log(`Prepared ${path.relative(root, outputDir)}/ (${(indexInfo.size / 1024).toFixed(1)} KB index, ${(bridgeInfo.size / 1024).toFixed(1)} KB bridge).`);
  console.log('Bundled assets — no remote server URL is configured.');
}

main().catch(error => {
  console.error(`sync-web failed: ${error.message}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Fails when any URL in the service worker's APP_SHELL is missing.
 * One missing file rejects cache.addAll(), so the worker never installs and
 * the app is not available offline after the first load.
 *
 *   node scripts/check-shell-urls.mjs <dir>        checks files on disk
 *   node scripts/check-shell-urls.mjs <https-url>  checks the live site (200 each)
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2];
if (!target) { console.error('usage: check-shell-urls.mjs <dir|url>'); process.exit(2); }
const isUrl = /^https?:\/\//.test(target);
const base = isUrl ? target.replace(/\/?$/, '/') : null;

async function load(rel) {
  if (!isUrl) return readFile(path.join(target, rel), 'utf8');
  for (let i = 0; i < 12; i++) {
    const res = await fetch(new URL(rel, base) + (i ? `${rel.includes('?') ? '&' : '?'}cb=${Date.now()}` : ''));
    if (res.ok) return res.text();
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error(`could not fetch ${rel}`);
}

const sw = await load('service-worker.js');
const match = sw.match(/APP_SHELL\s*=\s*(\[[^\]]*\])/);
if (!match) { console.error('APP_SHELL not found in service-worker.js'); process.exit(1); }
const urls = JSON.parse(match[1].replace(/'/g, '"'));
const missing = [];
for (const u of urls) {
  const clean = u === './' ? 'index.html' : u;
  if (isUrl) {
    let ok = false;
    for (let i = 0; i < 12 && !ok; i++) {
      const res = await fetch(new URL(u, base), { cache: 'no-store' });
      ok = res.status === 200;
      if (!ok) await new Promise(r => setTimeout(r, 10000));
    }
    if (!ok) missing.push(u);
  } else {
    try { const s = await stat(path.join(target, clean.split('?')[0])); if (!s.isFile() || s.size === 0) throw 0; }
    catch { missing.push(u); }
  }
}
if (missing.length) { console.error('Missing shell URLs:\n' + missing.join('\n')); process.exit(1); }
console.log(`OK: ${urls.length} shell URLs present (${isUrl ? 'HTTP 200' : 'on disk'})`);

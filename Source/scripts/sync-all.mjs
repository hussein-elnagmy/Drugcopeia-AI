#!/usr/bin/env node
/**
 * One command for the whole web layer. Reads the single release number in
 * ./REVISION, stamps it on webapp/index.html, webapp/service-worker.js (cache
 * name and every ?v=), then rebuilds www/ and copies it into the iOS, Android
 * and Windows projects. It ends by checking that page, worker and cache name
 * agree in every copy, and exits with an error if they do not.
 *
 *   npm run sync:all          stamp + copy + check
 *   npm run check:revision    check only
 */
import { cp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rev = (await readFile(path.join(root, 'REVISION'), 'utf8')).trim();
if (!/^\d+$/.test(rev)) throw new Error('REVISION must be a whole number');
const checkOnly = process.argv.includes('--check');
const skip = p => !/(^|[\\/])(\.DS_Store|Thumbs\.db)$/.test(p);

const copies = [
  'webapp', 'www', 'ios/App/App/public', 'android/app/src/main/assets/public', 'windows/www'
].map(p => path.join(root, p));

async function stamp(dir) {
  const htmlPath = path.join(dir, 'index.html');
  const swPath = path.join(dir, 'service-worker.js');
  let html = await readFile(htmlPath, 'utf8');
  let sw = await readFile(swPath, 'utf8');
  html = html.replace(/\?v=\d+/g, `?v=${rev}`);
  sw = sw.replace(/\?v=\d+/g, `?v=${rev}`).replace(/dawaya-shell-v\d+/, `dawaya-shell-v${rev}`);
  await writeFile(htmlPath, html);
  await writeFile(swPath, sw);
}

async function check() {
  const problems = [];
  for (const dir of copies) {
    const rel = path.relative(root, dir);
    try {
      const html = await readFile(path.join(dir, 'index.html'), 'utf8');
      const sw = await readFile(path.join(dir, 'service-worker.js'), 'utf8');
      const cache = (sw.match(/dawaya-shell-v(\d+)/) || [])[1];
      const revs = new Set([...html.matchAll(/\?v=(\d+)/g), ...sw.matchAll(/\?v=(\d+)/g)].map(m => m[1]));
      if (cache !== rev || revs.size !== 1 || !revs.has(rev)) problems.push(`${rel}: cache v${cache}, ?v= values {${[...revs].join(',')}}, expected ${rev}`);
      const shell = [...sw.matchAll(/'\.\/([^'?]+)(?:\?v=\d+)?'/g)].map(m => m[1]).filter(f => f && f !== '');
      for (const f of shell) { try { await stat(path.join(dir, f)); } catch { problems.push(`${rel}: precache path missing: ${f}`); } }
      const tags = [...html.matchAll(/<script src="([^"?]+)\?v=\d+"/g)].map(m => m[1]);
      for (const t of tags) if (!sw.includes(`./${t}?v=${rev}`) && t !== 'ios-shell.js') problems.push(`${rel}: ${t} is loaded by the page but not precached`);
    } catch (e) { problems.push(`${rel}: ${e.message}`); }
  }
  if (problems.length) { console.error('Revision check FAILED:\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log(`Revision check OK: all ${copies.length} copies are at v${rev}.`);
}

if (!checkOnly) {
  await stamp(copies[0]);
  await rm(copies[1], { recursive: true, force: true });
  await mkdir(copies[1], { recursive: true });
  await cp(copies[0], copies[1], { recursive: true, filter: skip });
  await cp(path.join(root, 'native', 'ios-shell.js'), path.join(copies[1], 'ios-shell.js'));
  let html = await readFile(path.join(copies[1], 'index.html'), 'utf8');
  const tag = `<script src="ios-shell.js?v=${rev}"></script>`;
  if (!html.includes(tag)) {
    const i = html.indexOf('<script src="core.js');
    if (i < 0) throw new Error('index.html has no core.js script tag');
    html = html.slice(0, i) + tag + '\n  ' + html.slice(i);
  }
  await writeFile(path.join(copies[1], 'index.html'), html);
  for (const dest of copies.slice(2)) {
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await cp(copies[1], dest, { recursive: true, filter: skip });
  }

  console.log(`Stamped revision ${rev} and copied the web layer into 4 targets.`);
}
await check();

#!/usr/bin/env node
/**
 * Verify the website contains the compiled REAL Kestrel editor, not merely
 * an iframe pointing at a file that has not been deployed.
 *
 * node scripts/site/verify-deployment.mjs [--root=site] [--live-url=https://...]
 * Local checks are required before publish; live checks run after Firebase deploy.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

function options() {
  const result = { root: 'site', liveUrl: '' };
  const seen = new Set();
  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/site/verify-deployment.mjs [--root=site] [--live-url=https://...]');
      process.exit(0);
    }
    const match = /^--(root|live-url)=(.+)$/.exec(arg);
    if (!match || seen.has(match[1])) throw new Error('Unknown, empty or repeated option: ' + arg);
    seen.add(match[1]);
    if (match[1] === 'root') result.root = match[2];
    else result.liveUrl = match[2];
  }
  return result;
}
function requireText(path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error('Required website file missing: ' + path);
  return readFileSync(path, 'utf8');
}
function builtAssets(html) {
  return [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)]
    .map(match => match[1].split(/[?#]/)[0])
    .filter(path => path.startsWith('/editor/assets/') || path.startsWith('assets/') || path.startsWith('./assets/'));
}
async function main() {
  const { root, liveUrl } = options();
  const dir = resolve(root);
  const landing = requireText(join(dir, 'index.html'));
  requireText(join(dir, 'admin.html'));
  if (!/editor\/demo-editor\.html/.test(landing)) {
    throw new Error('The homepage does not embed the compiled Kestrel editor.');
  }
  const demo = requireText(join(dir, 'editor', 'demo-editor.html'));
  if (!/id=["']root["']/.test(demo) || !/Kestrel editor demonstration/.test(demo)) {
    throw new Error('The compiled editor entry point does not look like the Kestrel editor.');
  }
  if (/src=["']\/src\/demo\/main\.tsx/.test(demo)) {
    throw new Error('Found a development entry point, not the compiled website editor.');
  }
  const assets = builtAssets(demo);
  const scripts = assets.filter(path => /\.js$/i.test(path));
  if (!scripts.length) throw new Error('Compiled editor has no JavaScript entry bundle.');
  for (const asset of assets) {
    let relative = asset.replace(/^\/editor\//, '').replace(/^\.\//, '');
    if (!relative.startsWith('assets/') || relative.includes('..') || relative.includes('\\')) {
      throw new Error('Unsafe compiled editor asset path: ' + asset);
    }
    const file = join(dir, 'editor', relative);
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
      throw new Error('Missing or empty compiled editor asset: ' + file);
    }
  }
  console.log('Local site PASS: homepage, admin, compiled editor and ' + assets.length + ' local assets.');
  if (!liveUrl) {
    console.log('Live Firebase deployment NOT RUN. Pass --live-url after publishing.');
    return;
  }
  const base = new URL(liveUrl);
  if (base.protocol !== 'https:') throw new Error('Live URL must use HTTPS.');
  for (const suffix of ['/', '/editor/demo-editor.html', ...assets.map(path =>
    path.startsWith('/editor/') ? path : '/editor/' + path.replace(/^\.\//, ''))]) {
    const uri = new URL(suffix, base);
    uri.searchParams.set('kestrel-health-check', String(Date.now()));
    const response = await fetch(uri, { signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html,application/javascript,text/css,*/*' } });
    if (!response.ok) throw new Error('Live Firebase path failed (' + response.status + '): ' + uri.pathname);
    const data = await response.text();
    if (!data || data.includes('Page Not Found') || (suffix.endsWith('.js') && /<html/i.test(data))) {
      throw new Error('Live Firebase path returned a missing or wrong asset: ' + uri.pathname);
    }
    if (suffix === '/' && !data.includes('editor/demo-editor.html')) {
      throw new Error('Live homepage is stale: no compiled-editor iframe.');
    }
    if (suffix === '/editor/demo-editor.html' && !data.includes('Kestrel editor demonstration')) {
      throw new Error('Live editor page is missing or stale.');
    }
  }
  console.log('Live Firebase PASS: current homepage, actual editor and compiled assets are reachable.');
}
main().catch(error => { console.error('WEBSITE NOT READY: ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; });

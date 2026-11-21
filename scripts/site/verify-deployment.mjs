#!/usr/bin/env node
/**
 * Verify the website contains the compiled photo editor, not merely
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
const editorPath = '/editor/demo-editor.html';
const embedsEditor = html => /<iframe\b[^>]*\ssrc=["']\/?editor\/demo-editor\.html["']/i.test(html);

function builtAssets(html) {
  const root = [...html.matchAll(/<div\b[^>]*>/gi)].find(([tag]) => /\sid=["']root["']/i.test(tag));
  if (!root || !/\sdata-demo-editor(?=\s|[=>])/i.test(root[0])) {
    throw new Error('The compiled editor entry point is missing its demo editor marker.');
  }
  if (/\ssrc=["']\/src\/demo\/main\.tsx/.test(html)) {
    throw new Error('Found a development entry point, not the compiled website editor.');
  }
  const references = [...html.matchAll(/<(script|link)\b[^>]*?\s(src|href)=["']([^"']+)["']/gi)]
    .map(([, tag, attribute, url]) => ({
      isScript: tag.toLowerCase() === 'script' && attribute.toLowerCase() === 'src',
      path: url.split(/[?#]/)[0],
    }))
    .filter(({ path }) => /^(?:\/editor\/|\.\/)?assets\//.test(path));
  if (!references.some(({ isScript, path }) => isScript && /\.js$/i.test(path))) {
    throw new Error('Compiled editor has no JavaScript entry bundle.');
  }
  const assets = references.map(({ path }) => path.startsWith('/editor/') ? path : '/editor/' + path.replace(/^\.\//, ''));
  for (const asset of assets) {
    if (!/^\/editor\/assets\/[a-z0-9_.\/-]+$/i.test(asset) || asset.includes('..')) {
      throw new Error('Unsafe compiled editor asset path: ' + asset);
    }
  }
  return [...new Set(assets)].sort();
}
async function main() {
  const { root, liveUrl } = options();
  const dir = resolve(root);
  const landing = requireText(join(dir, 'index.html'));
  requireText(join(dir, 'admin.html'));
  if (!embedsEditor(landing)) {
    throw new Error('The homepage does not embed the compiled photo editor.');
  }
  const demo = requireText(join(dir, 'editor', 'demo-editor.html'));
  const assets = builtAssets(demo);
  for (const asset of assets) {
    const file = join(dir, asset.slice(1));
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
  for (const suffix of ['/', editorPath, ...assets]) {
    const uri = new URL(suffix, base);
    uri.searchParams.set('kestrel-health-check', String(Date.now()));
    const response = await fetch(uri, { signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html,application/javascript,text/css,*/*' } });
    if (!response.ok) throw new Error('Live Firebase path failed (' + response.status + '): ' + uri.pathname);
    const data = await response.text();
    if (!data.trim() || data.includes('Page Not Found') || (assets.includes(suffix) && /^\s*(?:<!doctype html|<html)\b/i.test(data))) {
      throw new Error('Live Firebase path returned a missing or wrong asset: ' + uri.pathname);
    }
    if (suffix === '/' && !embedsEditor(data)) {
      throw new Error('Live homepage is stale: no compiled-editor iframe.');
    }
    if (suffix === editorPath) {
      const liveAssets = builtAssets(data);
      if (liveAssets.length !== assets.length || assets.some((asset, index) => asset !== liveAssets[index])) {
        throw new Error('The live editor page refers to a different set of compiled assets.');
      }
    }
  }
  console.log('Live Firebase PASS: current homepage, actual editor and compiled assets are reachable.');
}
main().catch(error => { console.error('WEBSITE NOT READY: ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; });

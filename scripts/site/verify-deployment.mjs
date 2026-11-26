#!/usr/bin/env node
/**
 * Verify the website before and after a publish: the homepage, admin console, sign-in callback, privacy page and brand
 * favicon are all present locally, and the live site serves exactly those files.
 *
 * node scripts/site/verify-deployment.mjs [--root=site] [--live-url=https://...] [--control-plane-url=https://...]
 * Local checks are required before publish; live checks run after Firebase deploy.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

function options() {
  const result = { root: 'site', liveUrl: '', controlPlaneUrl: '' };
  const seen = new Set();
  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/site/verify-deployment.mjs [--root=site] [--live-url=https://...] [--control-plane-url=https://...]');
      process.exit(0);
    }
    const match = /^--(root|live-url|control-plane-url)=(.+)$/.exec(arg);
    if (!match || seen.has(match[1])) throw new Error('Unknown, empty or repeated option: ' + arg);
    seen.add(match[1]);
    if (match[1] === 'root') result.root = match[2];
    else if (match[1] === 'live-url') result.liveUrl = match[2];
    else result.controlPlaneUrl = match[2];
  }
  return result;
}
function requireText(path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error('Required website file missing: ' + path);
  return readFileSync(path, 'utf8');
}
const callbackPath = '/oauth-callback.html';
const privacyPath = '/privacy.html';
const faviconPath = '/assets/brand/inflight/app-icons/favicon.svg';
function faviconHref(html) {
  const tag = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).find(tag => /\brel=["']icon["']/i.test(tag));
  return tag?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null;
}
function requireFavicon(html) {
  const href = faviconHref(html);
  if (!href || !/^(?:\/assets\/|assets\/)/.test(href) ||
      new URL(href, 'https://kestrel.invalid/').pathname !== faviconPath || /[?#]/.test(href)) {
    throw new Error('Homepage favicon missing or not the approved brand asset: ' + String(href));
  }
}
function isHtmlFallback(body) {
  return /^\s*(?:<!doctype html|<html)\b/i.test(body.subarray(0, 512).toString('utf8'));
}
async function main() {
  const { root, liveUrl, controlPlaneUrl } = options();
  if (controlPlaneUrl && !liveUrl) throw new Error('--control-plane-url needs --live-url: it checks the control plane accepts that website.');
  const dir = resolve(root);
  const landing = requireText(join(dir, 'index.html'));
  requireText(join(dir, 'admin.html'));
  // The cloud-drive sign-in pop-up returns here (src/providers/oauthSession.ts); the providers have this exact URL registered.
  if (!requireText(join(dir, callbackPath.slice(1))).includes('Finishing sign-in')) {
    throw new Error('The sign-in callback page is not the expected page: ' + callbackPath);
  }
  requireFavicon(landing);
  const favicon = requireText(join(dir, faviconPath.slice(1)));
  if (!/<svg\b/i.test(favicon) || !/<\/svg>/i.test(favicon)) throw new Error('Brand favicon is not a valid SVG document.');
  // Google and Dropbox production approval need a public privacy-policy address, and the home page links to it.
  if (!requireText(join(dir, privacyPath.slice(1))).includes('<h1>InFlight privacy</h1>') || !landing.includes('href="/privacy"')) {
    throw new Error('The privacy page is missing or the homepage does not link to it: ' + privacyPath);
  }
  console.log('Local site PASS: homepage, admin, sign-in callback, privacy page and favicon.');
  if (!liveUrl) {
    console.log('Live Firebase deployment NOT RUN. Pass --live-url after publishing.');
    return;
  }
  const base = new URL(liveUrl);
  if (base.protocol !== 'https:') throw new Error('Live URL must use HTTPS.');
  // Verification must target a single explicit HTTPS origin, never an arbitrary
  // subpath, credential-bearing URL or a URL with an inherited query/fragment.
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Live URL must be a bare HTTPS origin without credentials, path, query or fragment.');
  }
  for (const suffix of ['/', '/admin.html', callbackPath, privacyPath, faviconPath]) {
    const uri = new URL(suffix, base);
    uri.searchParams.set('kestrel-health-check', String(Date.now()));
    const response = await fetch(uri, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html,application/javascript,text/css,*/*' } });
    if (response.redirected || response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw new Error('Live Firebase path redirected: ' + uri.pathname);
    if (!response.ok) throw new Error('Live Firebase path failed (' + response.status + '): ' + uri.pathname);
    if (suffix === faviconPath) {
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length || isHtmlFallback(body)) {
        throw new Error('Live Firebase path returned a missing or wrong asset: ' + uri.pathname);
      }
      if (!body.equals(readFileSync(join(dir, suffix.slice(1))))) {
        throw new Error('Live favicon differs from the verified local build: ' + uri.pathname);
      }
      continue;
    }
    const data = await response.text();
    if (!data.trim() || data.includes('Page Not Found')) {
      throw new Error('Live Firebase path returned a missing or wrong asset: ' + uri.pathname);
    }
    if (suffix === '/') requireFavicon(data);
    // HTML pages are release artifacts too: matching script names is insufficient.
    if (suffix === '/' || suffix === '/admin.html' || suffix === callbackPath || suffix === privacyPath) {
      const localPath = suffix === '/' ? 'index.html' : suffix.slice(1);
      if (data !== requireText(join(dir, localPath))) {
        throw new Error('Live website page differs from the verified local build: ' + suffix);
      }
    }
  }
  console.log('Live Firebase PASS: every page and the favicon match the verified build byte for byte.');
  if (!controlPlaneUrl) {
    console.log('Live control plane NOT RUN. Pass --control-plane-url to check it answers this website.');
    return;
  }
  await verifyControlPlane(controlPlaneUrl, base.origin);
}

/** The website can only reach the control plane if it is live and lists this exact site origin (Terraform allowed_origins). */
async function verifyControlPlane(controlPlaneUrl, siteOrigin) {
  const cp = new URL(controlPlaneUrl);
  if (cp.protocol !== 'https:' || cp.username || cp.password || cp.pathname !== '/' || cp.search || cp.hash) {
    throw new Error('Control plane URL must be a bare HTTPS origin without credentials, path, query or fragment.');
  }
  // Cloud Run's front end answers /healthz itself with 404, so the public liveness route is /health.
  const response = await fetch(new URL('/health', cp), { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { origin: siteOrigin, accept: 'application/json' } });
  if (!response.ok) throw new Error('Live control plane /health failed (' + response.status + '); a revision older than this build has no /health route.');
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!body || body.ok !== true) throw new Error('Live control plane /health did not answer {"ok":true}.');
  const allowed = response.headers.get('access-control-allow-origin');
  if (allowed !== siteOrigin) {
    throw new Error('Live control plane does not allow the website origin ' + siteOrigin + ' (got ' + String(allowed) + '). Add it to Terraform allowed_origins and redeploy.');
  }
  console.log('Live control plane PASS: /health answers and the website origin ' + siteOrigin + ' is allowed.');
}
main().catch(error => { console.error('WEBSITE NOT READY: ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; });

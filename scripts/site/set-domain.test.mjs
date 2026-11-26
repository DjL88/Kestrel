import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./set-domain.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const OLD = 'https://kestrel-hosting-kestrel.web.app';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'set-domain-'));
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'site'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'config', 'public-site.json'), JSON.stringify({ origin: OLD, firebaseOrigin: OLD, files: ['site/index.html', 'site/robots.txt'] }));
  writeFileSync(join(root, 'site', 'index.html'), `<link rel="canonical" href="${OLD}/"><meta content="${OLD}/x.png">`);
  writeFileSync(join(root, 'site', 'robots.txt'), `Sitemap: ${OLD}/sitemap.xml\n`);
  writeFileSync(join(root, 'src', 'ok.ts'), "export const x = publicSiteUrl('/privacy.html');\n");
  return root;
}

test('this checkout agrees on one public site origin', () => {
  const result = run('--check');
  assert.equal(result.status, 0, result.stderr);
});

test('switching the domain rewrites every listed file and the config, then passes the check', () => {
  const root = fixture();
  try {
    const result = run('https://inflight.example', `--root=${root}`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, 'site', 'index.html'), 'utf8'), '<link rel="canonical" href="https://inflight.example/"><meta content="https://inflight.example/x.png">');
    assert.match(readFileSync(join(root, 'site', 'robots.txt'), 'utf8'), /^Sitemap: https:\/\/inflight\.example\/sitemap\.xml/);
    const config = JSON.parse(readFileSync(join(root, 'config', 'public-site.json'), 'utf8'));
    assert.equal(config.origin, 'https://inflight.example');
    assert.equal(config.firebaseOrigin, OLD, 'the Firebase address stays known so it can still be allowed');
    assert.equal(run('--check', `--root=${root}`).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a planned domain is recorded without changing anything, and becomes live only through the switch', () => {
  const root = fixture();
  try {
    const path = join(root, 'config', 'public-site.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...config, plannedOrigin: 'https://inflight.studio' }));
    assert.equal(run('--check', `--root=${root}`).status, 0, 'a planned domain changes nothing');
    assert.match(readFileSync(join(root, 'site', 'index.html'), 'utf8'), /kestrel-hosting-kestrel.web.app/);
    assert.equal(run('https://inflight.studio', `--root=${root}`).status, 0);
    const after = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(after.origin, 'https://inflight.studio');
    assert.equal(after.plannedOrigin, undefined);
    writeFileSync(path, JSON.stringify({ ...after, plannedOrigin: 'inflight.studio' }));
    assert.match(run('--check', `--root=${root}`).stderr, /plannedOrigin .* is not a bare https origin/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('this checkout serves inflight.studio and keeps the Firebase address on record', () => {
  const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../config/public-site.json', import.meta.url)), 'utf8'));
  assert.equal(config.origin, 'https://inflight.studio', 'connected 26 Nov 2026');
  assert.equal(config.plannedOrigin, undefined);
  assert.equal(config.firebaseOrigin, 'https://kestrel-hosting-kestrel.web.app');
});

test('refuses anything but a bare https origin', () => {
  const root = fixture();
  try {
    for (const bad of ['http://inflight.example', 'https://inflight.example/app', 'inflight.example', 'https://inflight.example/?a=1']) {
      assert.equal(run(bad, `--root=${root}`).status, 2, bad);
    }
    assert.equal(JSON.parse(readFileSync(join(root, 'config', 'public-site.json'), 'utf8')).origin, OLD);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the check catches a hard-coded site address in app source and a stale listed file', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'src', 'bad.tsx'), `const u = '${OLD}/privacy.html';\n`);
    const result = run('--check', `--root=${root}`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src[\\/]bad\.tsx: hard-codes/);
    rmSync(join(root, 'src', 'bad.tsx'));
    assert.equal(run('https://inflight.example', `--root=${root}`).status, 0);
    writeFileSync(join(root, 'site', 'robots.txt'), `Sitemap: ${OLD}/sitemap.xml\n`);
    assert.match(run('--check', `--root=${root}`).stderr, /robots\.txt: does not use https:\/\/inflight\.example/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

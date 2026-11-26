import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./verify-deployment.mjs', import.meta.url));
const privacy = '<h1>InFlight privacy</h1>';
const callback = '<p id="m">Finishing sign-in…</p>';
const iconPath = '/assets/brand/inflight/app-icons/favicon.svg';
const icon = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
const iconLink = '<link rel="icon" type="image/svg+xml" href="assets/brand/inflight/app-icons/favicon.svg">';
const landing = iconLink + '<a href="/privacy">Privacy</a>';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kestrel-site-gate-'));
  writeFileSync(join(root, 'index.html'), landing);
  writeFileSync(join(root, 'admin.html'), '<h1>Admin</h1>');
  writeFileSync(join(root, 'oauth-callback.html'), callback);
  writeFileSync(join(root, 'privacy.html'), privacy);
  mkdirSync(join(root, 'assets', 'brand', 'inflight', 'app-icons'), { recursive: true });
  writeFileSync(join(root, iconPath.slice(1)), icon);
  return root;
}
function run(root, ...args) {
  return spawnSync(process.execPath, [script, '--root=' + root, ...args], { encoding: 'utf8' });
}

function runLive(root, overrides) {
  const pages = {
    '/': landing,
    '/admin.html': '<h1>Admin</h1>',
    '/oauth-callback.html': callback,
    '/privacy.html': privacy,
    [iconPath]: icon,
    ...overrides,
  };
  return runStub(root, pages, {}, '--live-url=https://demo.example.test');
}

/** Stubbed fetch: site pages by path; control-plane responses keyed by host+path with optional CORS echo. */
function runStub(root, pages, api, ...args) {
  const stub = `globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    const api = ${JSON.stringify(api)}[u.host + u.pathname];
    if (api) {
      const headers = { 'content-type': 'application/json' };
      if (api.allow) headers['access-control-allow-origin'] = api.allow === 'echo' ? init.headers.origin : api.allow;
      return new Response(api.body, { status: api.status ?? 200, headers });
    }
    const pages = ${JSON.stringify(pages)};
    const body = pages[u.pathname];
    return new Response(body ?? null, { status: body === undefined ? 404 : 200 });
  };`;
  return spawnSync(process.execPath, [
    '--import=data:text/javascript,' + encodeURIComponent(stub), script, '--root=' + root, ...args,
  ], { encoding: 'utf8' });
}

test('accepts a complete site but never claims remote deployment', () => {
  const root = fixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Local site PASS/);
    assert.match(result.stdout, /Live Firebase deployment NOT RUN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fails closed when the sign-in callback page is missing or wrong', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'oauth-callback.html'), '<h1>Not it</h1>');
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sign-in callback page/);
    rmSync(join(root, 'oauth-callback.html'));
    assert.notEqual(run(root).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the published callback page is identical to the app\'s copy', () => {
  const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  assert.equal(read('../../site/oauth-callback.html'), read('../../public/oauth-callback.html'));
});

test('the Hosting site id is the live site, so a deploy cannot hit the empty default site', () => {
  const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../firebase.json', import.meta.url)), 'utf8'));
  assert.equal(config.hosting.site, 'kestrel-hosting-kestrel');
});

test('fails closed when the privacy page is missing or the homepage does not link to it', () => {
  const root = fixture();
  try {
    rmSync(join(root, 'privacy.html'));
    assert.match(run(root).stderr, /Required website file missing/);
    writeFileSync(join(root, 'privacy.html'), privacy);
    writeFileSync(join(root, 'index.html'), iconLink + '<p>No privacy link</p>');
    assert.match(run(root).stderr, /privacy page is missing or the homepage does not link/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('favicon gate rejects missing, mismatched and HTML-fallback icon assets', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(root).status, 0);
  writeFileSync(join(root, 'index.html'), landing.replace(iconLink, ''));
  assert.match(run(root).stderr, /favicon missing/);
  writeFileSync(join(root, 'index.html'), landing);
  rmSync(join(root, iconPath.slice(1)));
  assert.match(run(root).stderr, /Required website file missing/);
  writeFileSync(join(root, iconPath.slice(1)), icon);
  assert.match(runLive(root, { [iconPath]: '<!doctype html><html></html>' }).stderr, /missing or wrong asset/);
  assert.match(runLive(root, { [iconPath]: icon.replace('M0 0', 'M1 1') }).stderr, /favicon differs from the verified local build/);
  assert.match(runLive(root, { '/': landing.replace(iconLink, '') }).stderr, /favicon missing/);
});


test('rejects a changed live homepage even when its favicon reference matches', () => {
  const root = fixture();
  try {
    const changed = landing.replace('Privacy</a>', 'Privacy notice</a>');
    const result = runLive(root, { '/': changed });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Live website page differs from the verified local build: \/$/m);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects changed live OAuth callback and privacy content', () => {
  const root = fixture();
  try {
    for (const [path, changed] of [
      ['/oauth-callback.html', callback + '<!-- outdated -->'],
      ['/privacy.html', privacy + '<!-- outdated -->'],
    ]) {
      const result = runLive(root, { [path]: changed });
      assert.notEqual(result.status, 0, path);
      assert.match(result.stderr, /Live website page differs from the verified local build/);
      assert.ok(result.stderr.includes(path));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('live verification requires a bare HTTPS origin and rejects URL confusion', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const url of [
    'http://demo.example.test',
    'https://user:secret@demo.example.test',
    'https://demo.example.test/editor',
    'https://demo.example.test/?release=old',
    'https://demo.example.test/#editor',
  ]) {
    const result = run(root, '--live-url=' + url);
    assert.notEqual(result.status, 0, url);
    assert.match(result.stderr, /Live URL must/, url);
  }
});

test('live verification rejects a redirected response even when content matches', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pages = {
    '/': landing,
    '/admin.html': '<h1>Admin</h1>',
    '/oauth-callback.html': callback,
    '/privacy.html': privacy,
    [iconPath]: icon,
  };
  const stub = `globalThis.fetch = async url => {
    const pages = ${JSON.stringify(pages)};
    const body = pages[new URL(url).pathname];
    const response = new Response(body ?? null, { status: body === undefined ? 404 : 200 });
    if (new URL(url).pathname === '/admin.html') {
      Object.defineProperty(response, 'redirected', { value: true });
    }
    return response;
  };`;
  const result = spawnSync(process.execPath, [
    '--import=data:text/javascript,' + encodeURIComponent(stub),
    script, '--root=' + root, '--live-url=https://demo.example.test',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('Live Firebase path redirected: /admin.html'), result.stderr);
});


test('live admin page must match the locally verified release byte for byte', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(runLive(root, {}).status, 0);
  for (const stale of ['<h1>Old Admin</h1>', '<!doctype html><html>Fallback</html>', '']) {
    const result = runLive(root, { '/admin.html': stale });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Live website page differs|missing or wrong asset/);
  }
  assert.match(runLive(root, { '/admin.html': undefined }).stderr, /path failed \(404\): \/admin\.html/);
});

test('favicon must be a local approved asset, never an external or protocol-relative URL', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(run(root).status, 0);
  for (const malicious of [
    'https://elsewhere.example/assets/brand/inflight/app-icons/favicon.svg',
    '//elsewhere.example/assets/brand/inflight/app-icons/favicon.svg',
    'http://elsewhere.example/assets/brand/inflight/app-icons/favicon.svg',
    '/assets/brand/inflight/app-icons/favicon.svg?cache=old',
    '/assets/brand/inflight/app-icons/favicon.svg#different',
  ]) {
    writeFileSync(join(root, 'index.html'), landing.replace('assets/brand/inflight/app-icons/favicon.svg', malicious));
    const local = run(root);
    assert.notEqual(local.status, 0, malicious);
    assert.match(local.stderr, /favicon missing or not the approved brand asset/, malicious);
  }
  writeFileSync(join(root, 'index.html'), landing);
  assert.equal(runLive(root, { '/': landing.replace('assets/brand/inflight/app-icons/favicon.svg',
    'https://elsewhere.example/assets/brand/inflight/app-icons/favicon.svg') }).status === 0, false);
});


test('release verifier source never contains an escaped newline between favicon predicates', () => {
  const source = readFileSync(script, 'utf8');
  assert.equal(source.includes('||\\n      new URL('), false,
    'a literal backslash-n outside a string breaks JavaScript parsing');
});


test('live control plane must answer /health and allow the website origin', () => {
  const root = fixture();
  const pages = {
    '/': landing, '/admin.html': '<h1>Admin</h1>', '/oauth-callback.html': callback, '/privacy.html': privacy,
    [iconPath]: icon,
  };
  const live = ['--live-url=https://demo.example.test', '--control-plane-url=https://api.example.test'];
  try {
    const ok = runStub(root, pages, { 'api.example.test/health': { body: '{"ok":true}', allow: 'echo' } }, ...live);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Live control plane PASS/);
    const foreign = runStub(root, pages, { 'api.example.test/health': { body: '{"ok":true}' } }, ...live);
    assert.match(foreign.stderr, /does not allow the website origin https:\/\/demo\.example\.test.*allowed_origins/);
    const old = runStub(root, pages, {}, ...live);
    assert.match(old.stderr, /\/health failed \(404\)/);
    const bad = runStub(root, pages, { 'api.example.test/health': { body: '{"ok":false}', allow: 'echo' } }, ...live);
    assert.match(bad.stderr, /did not answer/);
    assert.match(run(root, '--control-plane-url=https://api.example.test').stderr, /needs --live-url/);
    assert.match(runStub(root, pages, {}, '--live-url=https://demo.example.test').stdout, /Live control plane NOT RUN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

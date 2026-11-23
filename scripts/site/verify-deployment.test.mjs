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
const bundle = 'console.log("editor")';
const landing = '<iframe src="editor/demo-editor.html"></iframe><a href="/privacy">Privacy</a>';
const demo = (title, entry = '/editor/assets/demo.js') =>
  `<html><title>${title}</title><body><div id="root" data-demo-editor></div><script type="module" src="${entry}"></script></body></html>`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kestrel-site-gate-'));
  const editor = join(root, 'editor');
  mkdirSync(join(editor, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), landing);
  writeFileSync(join(root, 'admin.html'), '<h1>Admin</h1>');
  writeFileSync(join(root, 'oauth-callback.html'), callback);
  writeFileSync(join(root, 'privacy.html'), privacy);
  writeFileSync(join(editor, 'demo-editor.html'), demo('InFlight editor demonstration'));
  writeFileSync(join(editor, 'assets', 'demo.js'), bundle);
  return root;
}
function run(root, ...args) {
  return spawnSync(process.execPath, [script, '--root=' + root, ...args], { encoding: 'utf8' });
}

function runLive(root, overrides) {
  const pages = {
    '/': landing,
    '/oauth-callback.html': callback,
    '/privacy.html': privacy,
    '/editor/demo-editor.html': demo('Demo Studio'),
    '/editor/assets/demo.js': bundle,
    ...overrides,
  };
  const stub = `globalThis.fetch = async url => {
    const pages = ${JSON.stringify(pages)};
    const body = pages[new URL(url).pathname];
    return new Response(body ?? null, { status: body === undefined ? 404 : 200 });
  };`;
  return spawnSync(process.execPath, [
    '--import=data:text/javascript,' + encodeURIComponent(stub), script, '--root=' + root,
    '--live-url=https://demo.example.test',
  ], { encoding: 'utf8' });
}

test('accepts complete compiled editor assets but never claims remote deployment', () => {
  const root = fixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Local site PASS/);
    assert.match(result.stdout, /Live Firebase deployment NOT RUN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fails closed when homepage refers to missing compiled editor or missing JS', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'editor', 'demo-editor.html'), '');
    assert.notEqual(run(root).status, 0);
    writeFileSync(join(root, 'editor', 'demo-editor.html'), demo('Photo editor', '/editor/assets/missing.js'));
    assert.match(run(root).stderr, /Missing or empty compiled editor asset/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects an unbuilt Vite development editor', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'editor', 'demo-editor.html'), demo('Photo editor', '/src/demo/main.tsx'));
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /development entry point/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('accepts the current live entry and rejects stale HTML even if its assets are still hosted', () => {
  const root = fixture();
  try {
    const current = runLive(root, { '/editor/demo-editor.html': demo('A different display name', './assets/demo.js') });
    assert.equal(current.status, 0, current.stderr);
    assert.match(current.stdout, /Live Firebase PASS/);
    assert.match(runLive(root, {
      '/editor/demo-editor.html': demo('Demo Studio', '/editor/assets/older.js'),
      '/editor/assets/older.js': bundle,
    }).stderr, /different set of compiled assets/);
    assert.match(runLive(root, { '/editor/assets/demo.js': '<!doctype html><html></html>' }).stderr, /missing or wrong asset/);
    assert.match(runLive(root, { '/editor/assets/demo.js': bundle.replace('editor', 'changed') }).stderr, /asset differs from the verified local build/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('checks both public Demo Editor routes and rejects a stale homepage or the wrong editor in the clean route', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const v2Landing = landing.replace('demo-editor.html', 'demo-v2');
  const v2 = demo('Version 2', '/editor/assets/v2.js');
  writeFileSync(join(root, 'index.html'), v2Landing);
  writeFileSync(join(root, 'editor', 'demo-v2.html'), v2);
  writeFileSync(join(root, 'editor', 'assets', 'v2.js'), bundle);
  const pages = { '/': v2Landing, '/editor/demo-v2.html': v2, '/editor/demo-v2': v2, '/editor/assets/v2.js': bundle };

  const valid = runLive(root, pages);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(runLive(root, { ...pages, '/': landing }).stderr, /expected the demo-v2 editor iframe/);
  assert.match(runLive(root, { ...pages, '/editor/demo-v2': undefined }).stderr, /path failed \(404\): \/editor\/demo-v2/);
  assert.match(runLive(root, { ...pages, '/editor/demo-v2': demo('Demo Studio') }).stderr, /different set of compiled assets: \/editor\/demo-v2/);
  assert.match(runLive(root, { ...pages, '/editor/demo-editor.html': undefined }).stderr, /path failed \(404\): \/editor\/demo-editor\.html/);
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
    writeFileSync(join(root, 'index.html'), '<iframe src="editor/demo-editor.html"></iframe>');
    assert.match(run(root).stderr, /privacy page is missing or the homepage does not link/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a homepage that embeds the Version 2 demo needs that demo compiled too, and still needs the current editor', () => {
  const root = fixture();
  writeFileSync(join(root, 'index.html'), '<iframe src="editor/demo-v2.html"></iframe><a href="/privacy">Privacy</a>');
  let result = run(root);
  assert.notEqual(result.status, 0, 'demo-v2.html is missing');
  assert.match(result.stderr + result.stdout, /demo-v2\.html/);
  writeFileSync(join(root, 'editor', 'demo-v2.html'), demo('InFlight editor demonstration'));
  result = run(root);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  rmSync(join(root, 'editor', 'demo-editor.html'));
  assert.notEqual(run(root).status, 0, 'the owner Demo Studio editor must stay compiled');
});

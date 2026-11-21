import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./verify-deployment.mjs', import.meta.url));
const landing = '<iframe src="editor/demo-editor.html"></iframe>';
const demo = (title, entry = '/editor/assets/demo.js') =>
  `<html><title>${title}</title><body><div id="root" data-demo-editor></div><script type="module" src="${entry}"></script></body></html>`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kestrel-site-gate-'));
  const editor = join(root, 'editor');
  mkdirSync(join(editor, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), landing);
  writeFileSync(join(root, 'admin.html'), '<h1>Admin</h1>');
  writeFileSync(join(editor, 'demo-editor.html'), demo('Kite44 editor demonstration'));
  writeFileSync(join(editor, 'assets', 'demo.js'), 'console.log("editor")');
  return root;
}
function run(root, ...args) {
  return spawnSync(process.execPath, [script, '--root=' + root, ...args], { encoding: 'utf8' });
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
  const runLive = (entry, asset = 'console.log("editor")') => {
    const pages = {
      '/': landing,
      '/editor/demo-editor.html': demo('A different display name', entry),
      '/editor/assets/demo.js': asset,
      '/editor/assets/older.js': 'console.log("old editor")',
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
  };
  try {
    const current = runLive('./assets/demo.js');
    assert.equal(current.status, 0, current.stderr);
    assert.match(current.stdout, /Live Firebase PASS/);
    assert.match(runLive('/editor/assets/older.js').stderr, /different set of compiled assets/);
    assert.match(runLive('/editor/assets/demo.js', '<!doctype html><html></html>').stderr, /missing or wrong asset/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

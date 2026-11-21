import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./verify-deployment.mjs', import.meta.url));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kestrel-site-gate-'));
  const editor = join(root, 'editor');
  mkdirSync(join(editor, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<iframe src="editor/demo-editor.html"></iframe>');
  writeFileSync(join(root, 'admin.html'), '<h1>Kestrel admin</h1>');
  writeFileSync(join(editor, 'demo-editor.html'), [
    '<html><title>Kestrel editor demonstration</title><body>',
    '<div id="root"></div><script type="module" src="/editor/assets/demo.js"></script>',
    '</body></html>',
  ].join(''));
  writeFileSync(join(editor, 'assets', 'demo.js'), 'console.log("Kestrel")');
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
    writeFileSync(join(root, 'editor', 'demo-editor.html'),
      '<title>Kestrel editor demonstration</title><div id="root"></div><script src="/editor/assets/missing.js"></script>');
    assert.notEqual(run(root).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects an unbuilt Vite development editor', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'editor', 'demo-editor.html'),
      '<title>Kestrel editor demonstration</title><div id="root"></div><script type="module" src="/src/demo/main.tsx"></script>');
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /development entry point/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

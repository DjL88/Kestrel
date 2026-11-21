import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { audit, inventory } from './audit-ui.mjs';

test('detects visible, accessible and runtime messages without inventing translation coverage', () => {
  const jsx = [
    '<button aria-label="Keep photo">Keep this photo</button>',
    'setError("Could not reopen the original photo")',
    'throw new Error("Export was interrupted")',
  ].join('\n');
  const findings = inventory(jsx, 'components/Review.tsx');
  assert.deepEqual(findings.map(x => x.kind).sort(), ['accessibility', 'runtime', 'runtime', 'visible']);
  assert.equal(findings.find(x => x.kind === 'accessibility').line, 1);
  assert.equal(inventory('setStatus("Reconnecting original")', 'core/relink.ts')[0].kind, 'runtime');
  assert.equal(inventory('const url = "https://example.org"', 'core/relink.ts').length, 0);
});

test('recursive audit excludes dictionaries and is deterministic', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kestrel-i18n-audit-'));
  try {
    await mkdir(join(root, 'components'));
    await mkdir(join(root, 'i18n'));
    await writeFile(join(root, 'components', 'Review.tsx'), '<span>Keep photo</span>');
    await writeFile(join(root, 'core.ts'), 'setError("Original missing")');
    await writeFile(join(root, 'i18n', 'en-GB.ts'), 'setError("Dictionary text")');
    const first = await audit(root);
    assert.deepEqual(first, await audit(root));
    assert.equal(first.length, 2);
    assert.deepEqual(first.map(x => x.file), ['components/Review.tsx', 'core.ts']);
    const cli = spawnSync(process.execPath, ['tools/i18n/audit-ui.mjs', '--json', '--src', root], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).count, 2);
    assert.match(JSON.parse(cli.stdout).limitations, /not verified/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing scan root fails closed', async () => {
  await assert.rejects(audit(join(tmpdir(), 'kestrel-i18n-does-not-exist-0000')), /ENOENT/);
});

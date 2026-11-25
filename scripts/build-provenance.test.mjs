import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseProblems, resolveProvenance, statusIsDirty, buildInfoDefines } from './build-provenance.mjs';
import { compareRecords, parseArgs } from './check-release-parity.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const now = new Date('2026-11-25T12:00:00Z');
const clean = (revision, target) => resolveProvenance({ git: { revision, dirty: false }, now, target });

test('a clean checkout stamps its full and short commit', () => {
  const info = clean(A, 'desktop');
  assert.equal(info.revision, A);
  assert.equal(info.shortRevision, A.slice(0, 12));
  assert.equal(info.dirty, false);
  assert.deepEqual(releaseProblems(info), []);
  assert.equal(buildInfoDefines(info)['import.meta.env.VITE_KESTREL_BUILD_FULL_REVISION'], JSON.stringify(A));
});

test('a release build refuses a changed tree', () => {
  assert.throws(() => resolveProvenance({ env: { KESTREL_RELEASE: '1' }, git: { revision: A, dirty: true }, target: 'desktop' }), /RELEASE BUILD BLOCKED.*uncommitted/);
  // Not a release: it builds, but says so.
  assert.equal(resolveProvenance({ git: { revision: A, dirty: true }, target: 'web' }).dirty, true);
});

test('a release build refuses an unknown revision (no .git and no KESTREL_BUILD_REVISION)', () => {
  assert.throws(() => resolveProvenance({ env: { KESTREL_RELEASE: '1' }, git: null, target: 'v2proto' }), /revision is unknown/);
});

test('an image build without .git takes the revision from KESTREL_BUILD_REVISION', () => {
  const info = resolveProvenance({ env: { KESTREL_RELEASE: '1', KESTREL_BUILD_REVISION: A.toUpperCase() }, git: null, target: 'v2proto' });
  assert.equal(info.revision, A);
  assert.equal(info.dirty, false);
  assert.throws(() => resolveProvenance({ env: { KESTREL_RELEASE: '1', KESTREL_BUILD_REVISION: A, KESTREL_BUILD_DIRTY: '1' }, git: null, target: 'v2proto' }), /uncommitted/);
});

test('a short, branch-name or contradicting KESTREL_BUILD_REVISION is refused', () => {
  assert.throws(() => resolveProvenance({ env: { KESTREL_BUILD_REVISION: 'main' }, git: null, target: 'web' }), /full 40-character/);
  assert.throws(() => resolveProvenance({ env: { KESTREL_BUILD_REVISION: A.slice(0, 12) }, git: null, target: 'web' }), /full 40-character/);
  assert.throws(() => resolveProvenance({ env: { KESTREL_BUILD_REVISION: B }, git: { revision: A, dirty: false }, target: 'web' }), /does not match/);
});

test('untracked notes do not make a build dirty; untracked build inputs and any tracked change do', () => {
  assert.equal(statusIsDirty(''), false);
  assert.equal(statusIsDirty('?? .claude/\n?? HANDOVER-2026-11-25.md\n?? WARNING\n'), false);
  assert.equal(statusIsDirty('?? src/core/newThing.ts\n'), true);
  assert.equal(statusIsDirty('?? public/models/extra.onnx\n'), true);
  assert.equal(statusIsDirty('?? vite.config.ts\n'), true);
  assert.equal(statusIsDirty(' M docs/ROADMAP.md\n'), true);
  assert.equal(statusIsDirty('M  src/App.tsx\n'), true);
});

test('parity passes only when every build is the same clean commit', () => {
  assert.deepEqual(compareRecords([{ name: 'desktop', info: clean(A, 'desktop') }, { name: 'web', info: clean(A, 'v2proto') }]), []);
  assert.deepEqual(compareRecords([{ name: 'desktop', info: clean(A, 'desktop') }, { name: 'web', info: clean(A, 'v2proto') }], A), []);
});

test('parity fails when builds differ, are dirty, unknown, unreadable, alone, or not the release commit', () => {
  const differ = compareRecords([{ name: 'desktop', info: clean(A, 'desktop') }, { name: 'web', info: clean(B, 'v2proto') }]);
  assert.match(differ.join('\n'), /different commits: desktop=aaaaaaaaaaaa, web=bbbbbbbbbbbb/);
  const dirty = compareRecords([{ name: 'desktop', info: { ...clean(A, 'desktop'), dirty: true } }, { name: 'web', info: clean(A, 'v2proto') }]);
  assert.match(dirty.join('\n'), /desktop: the source tree had uncommitted changes/);
  const unknown = compareRecords([{ name: 'desktop', info: { revision: null, dirty: false } }, { name: 'web', info: clean(A, 'v2proto') }]);
  assert.match(unknown.join('\n'), /desktop: the source revision is unknown/);
  const missing = compareRecords([{ name: 'models', error: 'could not be read' }, { name: 'web', info: clean(A, 'v2proto') }]);
  assert.match(missing.join('\n'), /models: could not be read/);
  assert.match(compareRecords([{ name: 'web', info: clean(A, 'v2proto') }]).join('\n'), /at least two builds/);
  assert.match(compareRecords([{ name: 'desktop', info: clean(A, 'desktop') }, { name: 'web', info: clean(A, 'web') }], B).join('\n'), /not the release commit/);
  // Missing dirty flag is not a clean build.
  assert.match(compareRecords([{ name: 'desktop', info: { revision: A } }, { name: 'web', info: clean(A, 'web') }]).join('\n'), /uncommitted/);
});

test('the parity command exits non-zero on a mismatch and zero on a match', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kestrel-parity-'));
  const write = (name, info) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(info)); return path; };
  const script = fileURLToPath(new URL('./check-release-parity.mjs', import.meta.url));
  const desktop = write('desktop.json', clean(A, 'desktop'));
  const web = write('web.json', clean(A, 'v2proto'));
  const stale = write('stale.json', clean(B, 'v2proto'));
  const ok = spawnSync(process.execPath, [script, `--desktop=${desktop}`, `--web=${web}`], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /PASSED/);
  const bad = spawnSync(process.execPath, [script, `--desktop=${desktop}`, `--web=${stale}`], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /different commits/);
  const absent = spawnSync(process.execPath, [script, `--desktop=${desktop}`, `--models=${join(dir, 'nope.json')}`], { encoding: 'utf8' });
  assert.equal(absent.status, 1);
  assert.throws(() => parseArgs(['--web=a', '--web=b']), /Repeated/);
});

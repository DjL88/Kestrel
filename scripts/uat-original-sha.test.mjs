import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, utimes, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runIntegrityCommand, compareOriginals, hashOriginal, listOriginals } from './uat-original-sha.mjs';

async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'inflight-uat-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const originals = path.join(temp, 'camera');
  await mkdir(originals);
  const manifest = path.join(temp, 'before.json');
  const photo = path.join(originals, 'Z8_001.NEF');
  await writeFile(photo, Buffer.from('original nikon bytes'));
  return { temp, originals, manifest, photo };
}

test('baseline and verification prove the same bytes without changing originals', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.photo);
  const base = await runIntegrityCommand('baseline', f.originals, f.manifest);
  assert.equal(base.checked, 1);
  assert.equal((await runIntegrityCommand('verify', f.originals, f.manifest)).ok, true);
  assert.deepEqual(await readFile(f.photo), before);
  await assert.rejects(runIntegrityCommand('baseline', f.originals, f.manifest), { code: 'EEXIST' });
});

test('replacement with same filename, byte count and modification time is detected by SHA-256', async (t) => {
  const f = await fixture(t);
  const oldStats = (await import('node:fs/promises')).stat;
  const original = await oldStats(f.photo);
  await runIntegrityCommand('baseline', f.originals, f.manifest);
  await writeFile(f.photo, Buffer.from('changed  nikon bytes'));
  await utimes(f.photo, original.atime, original.mtime);
  const report = await runIntegrityCommand('verify', f.originals, f.manifest);
  assert.deepEqual(report.changed, ['Z8_001.NEF']);
  assert.equal(report.ok, false);
  assert.equal((await oldStats(f.photo)).size, original.size);
});

test('deleted, added and nested original files are reported separately', async (t) => {
  const f = await fixture(t);
  await runIntegrityCommand('baseline', f.originals, f.manifest);
  await rm(f.photo);
  await mkdir(path.join(f.originals, 'sub'));
  await writeFile(path.join(f.originals, 'sub', 'new.JpG'), 'other photo');
  await writeFile(path.join(f.originals, 'notes.txt'), 'not an original');
  const result = await runIntegrityCommand('verify', f.originals, f.manifest);
  assert.deepEqual(result.missing, ['Z8_001.NEF']);
  assert.deepEqual(result.added, ['sub/new.JpG']);
});

test('manifest must be outside source and is never overwritten', async (t) => {
  const f = await fixture(t);
  await assert.rejects(runIntegrityCommand('baseline', f.originals, path.join(f.originals, 'manifest.json')), /OUTSIDE/);
  await runIntegrityCommand('baseline', f.originals, f.manifest);
  await assert.rejects(runIntegrityCommand('baseline', f.originals, f.manifest), { code: 'EEXIST' });
});

test('symlink cannot silently import a different linked photo or escape source folder', async (t) => {
  const f = await fixture(t);
  await symlink(f.photo, path.join(f.originals, 'linked.NEF'));
  await assert.rejects(listOriginals(f.originals), /symbolic link/);
});

test('manifest cannot contain traversals, duplicates or fabricated hash values', () => {
  const good = { path: 'a.NEF', bytes: 12, sha256: 'a'.repeat(64) };
  for (const bad of [{ ...good, path: '../outside.NEF' }, { ...good, sha256: 'fake' }]) {
    assert.throws(() => compareOriginals([bad], []), /Invalid/);
  }
  assert.throws(() => compareOriginals([good, good], []), /duplicate/);
});

test('streaming works for multi-megabyte originals without loading the file in a single buffer', async (t) => {
  const f = await fixture(t);
  await writeFile(f.photo, Buffer.alloc(3 * 1024 * 1024, 4));
  const result = await hashOriginal(f.photo);
  assert.equal(result.bytes, 3 * 1024 * 1024);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyDesktopRelinkFiles } from './originalRelinkNode';

const identity = (photoId: string, bytes: string) => ({
  photoId, byteLength: Buffer.byteLength(bytes),
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
async function sandbox(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'kestrel-relink-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('streams full-file bytes and returns a verified relink plan', async () => sandbox(async dir => {
  const path = join(dir, 'bird.nef');
  await writeFile(path, 'original Nikon bytes');
  const result = await verifyDesktopRelinkFiles(
    [identity('bird', 'original Nikon bytes')], [{ photoId: 'bird', path }],
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.matches, [{ photoId: 'bird', candidateKey: path }]);
}));

test('rejects same-size changed bytes and never emits partial matches', async () => sandbox(async dir => {
  const a = join(dir, 'a.nef'), b = join(dir, 'b.nef');
  await writeFile(a, 'osprey');
  await writeFile(b, 'copier');
  const result = await verifyDesktopRelinkFiles(
    [identity('a', 'osprey'), identity('b', 'osprey')],
    [{ photoId: 'a', path: a }, { photoId: 'b', path: b }],
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.failures.some(x => x.photoId === 'b'));
}));

test('rejects duplicate physical file, even with distinct photo IDs', async () => sandbox(async dir => {
  const path = join(dir, 'same.nef');
  await writeFile(path, 'same');
  const result = await verifyDesktopRelinkFiles(
    [identity('a', 'same'), identity('b', 'same')],
    [{ photoId: 'a', path }, { photoId: 'b', path }],
  );
  assert.equal(result.ok, false);
}));

test('rejects symlinks, missing files and relative paths', async () => sandbox(async dir => {
  const target = join(dir, 'target.nef'), link = join(dir, 'link.nef');
  await writeFile(target, 'bird');
  await symlink(target, link);
  for (const path of [link, join(dir, 'missing.nef'), 'relative.nef']) {
    const result = await verifyDesktopRelinkFiles([identity('bird', 'bird')], [{ photoId: 'bird', path }]);
    assert.equal(result.ok, false);
  }
}));

test('500 synthetic files stream sequentially; one replacement rejects all', async () => sandbox(async dir => {
  const originals = Array.from({ length: 500 }, (_, i) => identity('p' + i, 'synthetic-' + i));
  const files = originals.map(o => ({ photoId: o.photoId, path: join(dir, o.photoId + '.nef') }));
  await Promise.all(files.map((f, i) => writeFile(f.path, 'synthetic-' + i)));
  assert.equal((await verifyDesktopRelinkFiles(originals, files)).ok, true);
  await writeFile(files[379].path, 'replacement');
  const result = await verifyDesktopRelinkFiles(originals, files);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.failures.some(f => f.photoId === 'p379'));
}));


test('rejects distinct hard-link paths to the same physical file', async () => sandbox(async dir => {
  const first = join(dir, 'first.nef'), second = join(dir, 'second.nef');
  await writeFile(first, 'identical original bytes');
  await link(first, second);
  const result = await verifyDesktopRelinkFiles(
    [identity('one', 'identical original bytes'), identity('two', 'identical original bytes')],
    [{ photoId: 'one', path: first }, { photoId: 'two', path: second }],
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.failures.some(f => f.photoId === 'two' && f.reason === 'duplicate-candidate-path'));
}));

test('a hard link cannot be used to relink a second photo in a 500-file batch', async () => sandbox(async dir => {
  const originals = Array.from({ length: 500 }, (_, i) => identity('p' + i, 'original-' + i));
  const files = originals.map(o => ({ photoId: o.photoId, path: join(dir, o.photoId + '.nef') }));
  await Promise.all(files.map((f, i) => writeFile(f.path, 'original-' + i)));
  // Two IDs with the same bytes are still distinct catalogue originals.
  await rm(files[499].path);
  await link(files[0].path, files[499].path);
  originals[499] = identity('p499', 'original-0');
  const result = await verifyDesktopRelinkFiles(originals, files);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.failures.some(f => f.photoId === 'p499' && f.reason === 'duplicate-candidate-path'));
}));

test('an already cancelled 500-photo relink returns no partial matches', async () => sandbox(async dir => {
  const controller = new AbortController();
  controller.abort();
  const originals = Array.from({ length: 500 }, (_, i) => identity('p' + i, 'original-' + i));
  const files = originals.map(o => ({ photoId: o.photoId, path: join(dir, o.photoId + '.nef') }));
  const result = await verifyDesktopRelinkFiles(originals, files, controller.signal);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.failures.some(f => f.reason === 'relink-cancelled'));
}));

test('cancellation leaves an existing original unchanged', async () => sandbox(async dir => {
  const path = join(dir, 'keeper.nef');
  const bytes = 'original bird bytes';
  await writeFile(path, bytes);
  const controller = new AbortController();
  controller.abort();
  const result = await verifyDesktopRelinkFiles([identity('keeper', bytes)], [{ photoId: 'keeper', path }], controller.signal);
  assert.equal(result.ok, false);
  assert.equal(await (await import('node:fs/promises')).readFile(path, 'utf8'), bytes);
}));

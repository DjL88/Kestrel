import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySafeCopyCatalog, type SafeCopyCatalog } from '../src/safeCopy.ts';
import { FirestoreSafeCopyCatalog } from '../src/safeCopyFirestore.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const sha = (c: string) => c.repeat(64);
// One contract over both catalogs, so the fake the gate is tested with cannot drift from Firestore.
for (const [name, make] of [['memory', () => new MemorySafeCopyCatalog()], ['firestore', () => new FirestoreSafeCopyCatalog(new MemoryFirestore())]] as Array<[string, () => SafeCopyCatalog]>) {
  test(`${name}: settings default off and merge per level`, async () => {
    const c = make();
    assert.deepEqual(await c.getSettings('a'), { recipes: false, previews: false, originals: false });
    assert.deepEqual(await c.setSettings('a', { previews: true }), { recipes: false, previews: true, originals: false });
    assert.deepEqual(await c.setSettings('a', { recipes: true }), { recipes: true, previews: true, originals: false });
    assert.equal((await c.getSettings('b')).previews, false);
  });
  test(`${name}: reserve, commit, quota, free re-upload, remove`, async () => {
    const c = make();
    assert.equal(await c.reserve('a', 'previews', sha('1'), 400, 1000), 'reserved');
    assert.equal(await c.reserve('a', 'previews', sha('1'), 400, 1000), 'reserved', 'a retry before commit is not double counted');
    assert.equal(await c.usage('a'), 400);
    assert.equal(await c.reserve('a', 'previews', sha('2'), 700, 1000), 'quota');
    assert.equal(await c.commit('a', 'previews', sha('1')), true);
    assert.equal(await c.commit('a', 'previews', sha('9')), false);
    assert.equal(await c.reserve('a', 'previews', sha('1'), 400, 1000), 'stored');
    assert.deepEqual(await c.get('a', 'previews', sha('1')), { bytes: 400, committed: true });
    assert.equal(await c.get('b', 'previews', sha('1')), undefined, 'accounts are separate');
    await c.remove('a', 'previews', sha('1')); await c.remove('a', 'previews', sha('1'));
    assert.equal(await c.usage('a'), 0);
    assert.equal(await c.get('a', 'previews', sha('1')), undefined);
  });
  test(`${name}: concurrent reserves never exceed the quota`, async () => {
    const c = make();
    const r = await Promise.all(Array.from({ length: 10 }, (_, i) => c.reserve('a', 'previews', sha(String(i)), 400, 1000)));
    assert.equal(r.filter((x) => x === 'reserved').length, 2);
    assert.equal(await c.usage('a'), 800);
  });
}

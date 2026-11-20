import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportQueueJournal, type ExportQueueCheckpoint } from './exportQueueJournal.ts';

const hash = 'a'.repeat(64);
const item = { sourceId: 'original-1', sourceSha256: hash, filename: 'bird.tif', subfolder: 'Master' };
const plan = (): ExportQueueCheckpoint<{ quality: number }> => ({
  version: 1, id: 'batch_01', title: 'Export', items: [item],
  recipe: { quality: 100 }, receipts: [], state: 'pending',
});
function setup() {
  const map = new Map<string, string>();
  const journal = createExportQueueJournal({
    read: k => map.get(k) ?? null, write: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
  });
  return { journal, map };
}
test('snapshot survives caller mutation and is restored after journal recreation', () => {
  const { journal, map } = setup();
  const original = plan();
  journal.save(original);
  original.recipe.quality = 5;
  const reopened = createExportQueueJournal({
    read: k => map.get(k) ?? null, write: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
  }).load<{ quality: number }>('batch_01');
  assert.equal(reopened?.recipe.quality, 100);
});
test('explicit resume checks every original and every completed output', async () => {
  const { journal } = setup();
  journal.save(plan());
  journal.receipt('batch_01', { index: 0, relativePath: 'Master/bird.tif', outputSha256: hash });
  let sources = 0, outputs = 0;
  const result = await journal.pendingForExplicitResume('batch_01', async () => { sources++; return true; },
    async () => { outputs++; return true; });
  assert.deepEqual(result.pending, []);
  assert.equal(sources, 1);
  assert.equal(outputs, 1);
  await assert.rejects(journal.pendingForExplicitResume('batch_01', async () => false, async () => true), /Original identity/);
  await assert.rejects(journal.pendingForExplicitResume('batch_01', async () => true, async () => false), /changed or disappeared/);
});
test('uncompleted work remains pending; paused jobs never resume automatically', async () => {
  const { journal } = setup();
  journal.save({ ...plan(), items: [item, { ...item, sourceId: 'original-2', filename: 'other.tif' }] });
  journal.receipt('batch_01', { index: 0, relativePath: 'Master/bird.tif', outputSha256: hash });
  journal.pause('batch_01');
  const result = await journal.pendingForExplicitResume('batch_01', async () => true, async () => true);
  assert.deepEqual(result.pending, [1]);
  assert.equal(result.checkpoint.state, 'paused');
});
test('rejects corrupt, swapped, colliding and forged complete checkpoints', () => {
  const { journal, map } = setup();
  assert.throws(() => journal.save({ ...plan(), items: [item, { ...item, filename: 'BIRD.TIF' }] }), /collision/);
  assert.throws(() => journal.save({ ...plan(), state: 'completed' }), /Incomplete/);
  assert.throws(() => journal.save({ ...plan(), items: [{ ...item, filename: '../bird.tif' }] }), /Unsafe/);
  map.set('kestrel.export.v1.batch_01', '{bad');
  assert.throws(() => journal.load('batch_01'), /Corrupt/);
  map.set('kestrel.export.v1.batch_01', JSON.stringify({ ...plan(), id: 'other' }));
  assert.throws(() => journal.load('batch_01'), /identity mismatch/);
});
test('storage write failures propagate; no false accepted checkpoint', () => {
  const journal = createExportQueueJournal({
    read: () => null, write: () => { throw new Error('Disk full'); }, remove: () => {},
  });
  assert.throws(() => journal.save(plan()), /Disk full/);
});
test('rejects duplicate or mismatched completion receipts', () => {
  const { journal } = setup();
  journal.save(plan());
  assert.throws(() => journal.receipt('batch_01', { index: 0, relativePath: 'Wrong/bird.tif', outputSha256: hash }), /receipt/);
  journal.receipt('batch_01', { index: 0, relativePath: 'Master/bird.tif', outputSha256: hash });
  assert.throws(() => journal.receipt('batch_01', { index: 0, relativePath: 'Master/bird.tif', outputSha256: hash }), /already recorded/);
});

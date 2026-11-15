import assert from 'node:assert/strict';
import test from 'node:test';
import { applySnapshot, buildSnapshot, parseSnapshot, planApply, syncNameFor } from './projectSnapshot.ts';
import type { PhotoFrame } from './types.ts';

const frame = (key: string, extra: Partial<PhotoFrame> = {}) => ({ id: key, stableKey: key, filename: `${key}.jpg`, decision: 'unreviewed', isDemo: false, ...extra }) as unknown as PhotoFrame;

test('a snapshot holds decisions, ratings and edits, and skips removed, copies and demo photos', () => {
  const snap = buildSnapshot('Kite day', [
    frame('a', { decision: 'keep', rating: 4, tags: ['Red Kite'] }), frame('b', { removedAt: 5 }),
    frame('c', { virtualCopy: { originalFrameId: 'a', number: 1 } }), frame('d', { isDemo: true }), frame('a'),
  ], new Date('2026-11-15T10:00:00Z'));
  assert.deepEqual(snap.photos.map((p) => p.key), ['a']);
  assert.equal(snap.photos[0].rating, 4);
});

test('a snapshot reads back; a wrong file does not', () => {
  const snap = buildSnapshot('x', [frame('a')], new Date());
  assert.deepEqual(parseSnapshot(JSON.stringify(snap))?.photos.map((p) => p.key), ['a']);
  for (const bad of ['', 'nope', '{}', '{"format":"kestrel-project-sync","version":1}']) assert.equal(parseSnapshot(bad), null, bad);
});

test('the plan counts what would change before anything does', () => {
  const snap = buildSnapshot('x', [frame('a', { decision: 'keep' }), frame('b', { decision: 'reject' }), frame('gone', { decision: 'keep' })], new Date());
  const here = [frame('a', { decision: 'keep' }), frame('b', { decision: 'unreviewed' }), frame('only-here')];
  assert.deepEqual(planApply(here, snap), { matching: 2, changed: 1, missingHere: 1 });
});

test('applying changes only matching photos', () => {
  const snap = buildSnapshot('x', [frame('a', { decision: 'keep', rating: 5 })], new Date());
  const here = [frame('a', { decision: 'reject', tags: ['old'] }), frame('other', { decision: 'keep' })];
  const result = applySnapshot(here, snap);
  assert.equal(result[0].decision, 'keep');
  assert.equal(result[0].rating, 5);
  assert.equal(result[0].tags, undefined);
  assert.equal(result[1], here[1]);
});

test('sync names are plain and stable', () => {
  assert.equal(syncNameFor('Kite Day — Wales!'), 'kite-day-wales');
  assert.equal(syncNameFor('   '), 'project');
});

test('malformed or hostile sync data is rejected wholly, never partially applied', () => {
  const valid = buildSnapshot('x', [frame('a', { decision: 'keep' })], new Date('2026-11-15T10:00:00Z'));
  const original = valid.photos[0];
  const invalid = [
    { ...valid, photos: [original, { key: 'b', decision: 'erase' }] },
    { ...valid, photos: [original, { ...original, key: 'a' }] },
    { ...valid, photos: [{ ...original, rating: 999 }] },
    { ...valid, photos: [{ ...original, edit: JSON.parse('{\"constructor\":\"bad\"}') }] },
    { ...valid, photos: [{ ...original, tags: 'not an array' }] },
    { ...valid, title: 123 },
    { ...valid, photos: Array(100001).fill(original) },
  ];
  for (const item of invalid) assert.equal(parseSnapshot(JSON.stringify(item)), null);
  assert.equal(parseSnapshot('X'.repeat(8_000_001)), null);
});

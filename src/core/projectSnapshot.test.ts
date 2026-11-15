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

import { identityOf, isNewerHere, looksLikeAnotherProject } from './projectSnapshot.ts';

const shot = (key: string, filename: string, taken: number | undefined, extra: Partial<PhotoFrame> = {}) =>
  ({ id: key, stableKey: key, filename, decision: 'unreviewed', isDemo: false, exif: taken === undefined ? {} : { capturedAtMs: taken }, ...extra }) as unknown as PhotoFrame;

test('the same photo is found even when it was imported a different way on each device', () => {
  const there = buildSnapshot('x', [shot('local-file://DSC_1.NEF::900::111', 'DSC_1.NEF', 5000, { decision: 'keep', rating: 5 })], new Date(), 'p-there');
  const here = [shot('folder://2026/DSC_1.NEF', 'dsc_1.nef', 5000)];
  assert.equal(identityOf(here[0]), 'dsc_1.nef|5000');
  assert.deepEqual(planApply(here, there), { matching: 1, changed: 1, missingHere: 0 });
  assert.equal(applySnapshot(here, there)[0].rating, 5);
});

test('different photos with the same name but another capture time are not mixed up', () => {
  const there = buildSnapshot('x', [shot('a', 'IMG_0001.CR3', 1000, { decision: 'keep' })], new Date());
  assert.equal(planApply([shot('b', 'IMG_0001.CR3', 2000)], there).matching, 0);
});

test('a saved copy with another project id and few matching photos is flagged; the same project or a good match is not', () => {
  const frames = [shot('1', 'a.jpg', 1), shot('2', 'b.jpg', 2), shot('3', 'c.jpg', 3), shot('4', 'd.jpg', 4)];
  const other = buildSnapshot('Kite', [shot('x', 'x.jpg', 9), shot('y', 'y.jpg', 8), shot('1', 'a.jpg', 1)], new Date(), 'other');
  assert.equal(looksLikeAnotherProject(frames, other, 'mine'), true);
  assert.equal(looksLikeAnotherProject(frames, { ...other, projectId: 'mine' }, 'mine'), false);
  const sameJob = buildSnapshot('Kite', frames, new Date(), 'their-id');
  assert.equal(looksLikeAnotherProject(frames, sameJob, 'mine'), false);
  assert.equal(looksLikeAnotherProject(frames, buildSnapshot('Kite', [], new Date(), 'z'), 'mine'), false);
});

test('newer work on this device than the saved copy is flagged', () => {
  const snap = buildSnapshot('x', [], new Date('2026-11-15T10:00:00Z'));
  assert.equal(isNewerHere(Date.parse('2026-11-15T12:00:00Z'), snap), true);
  assert.equal(isNewerHere(Date.parse('2026-11-15T09:00:00Z'), snap), false);
  assert.equal(isNewerHere(undefined, snap), false);
});

test('identity and project id survive saving and reading, and bad ones are refused', () => {
  const snap = buildSnapshot('x', [shot('a', 'a.jpg', 10)], new Date(), 'pid');
  const back = parseSnapshot(JSON.stringify(snap));
  assert.equal(back?.projectId, 'pid');
  assert.equal(back?.photos[0].identity, 'a.jpg|10');
  const bad = JSON.parse(JSON.stringify(snap)); bad.photos[0].identity = 5;
  assert.equal(parseSnapshot(JSON.stringify(bad)), null);
});

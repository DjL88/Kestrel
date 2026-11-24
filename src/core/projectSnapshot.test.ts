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


test('verified bytes match across renamed paths but reject conflicting same-name and same-key originals', () => {
  const hash = 'a'.repeat(64), other = 'b'.repeat(64);
  const snap = buildSnapshot('Birds', [shot('old', 'DSC_1.NEF', 5000, { originalSha256: hash, rating: 5 })], new Date());
  const parsed = parseSnapshot(JSON.stringify(snap))!;
  const renamed = shot('new', 'renamed.NEF', 5000, { originalSha256: hash });
  assert.equal(applySnapshot([renamed], parsed)[0].rating, 5);
  for (const target of [shot('old', 'DSC_1.NEF', 5000, { originalSha256: other }), shot('new', 'DSC_1.NEF', 5000), shot('old', 'DSC_1.NEF', 5000)]) {
    assert.equal(planApply([target], parsed).matching, 0);
    assert.equal(applySnapshot([target], parsed)[0], target);
  }
});

test('ambiguous legacy capture identity and duplicate local originals are not silently matched', () => {
  const snap = buildSnapshot('Birds', [shot('old', 'DSC_1.NEF', 5000, { rating: 5 }), shot('other', 'DSC_1.NEF', 5000, { rating: 1 })], new Date());
  const here = [shot('new', 'DSC_1.NEF', 5000)];
  assert.equal(planApply(here, snap).matching, 0);
  const single = buildSnapshot('Birds', [shot('old', 'DSC_1.NEF', 5000, { rating: 5 })], new Date());
  assert.equal(planApply([...here, shot('second', 'DSC_1.NEF', 5000)], single).matching, 0);
  assert.equal(planApply([shot('old', 'DSC_1.NEF', 5000, { removedAt: 0 })], single).matching, 0);
});


test('a legacy remote record cannot be applied to two local records via different match routes', () => {
  const snap = buildSnapshot('Birds', [shot('old', 'DSC_1.NEF', 5000, { rating: 5 })], new Date());
  const here = [shot('old', 'renamed.NEF', 5001), shot('new', 'DSC_1.NEF', 5000)];
  assert.equal(planApply(here, snap).matching, 0);
  assert.deepEqual(applySnapshot(here, snap), here);
});


test('sync refuses malformed editing data before applying it to the local catalogue', () => {
  const snapshot = buildSnapshot('Birds', [frame('a', { rating: 4 }), frame('b')], new Date());
  const row = snapshot.photos[1];
  const edit = { exposure: 0, warmth: 0, colour: 0 };
  const framing = { ratio: null, turns: 0, straighten: 0, x: 0.5, y: 0.5 };
  for (const patch of [
    { decision: ['keep'] },
    { edit: 'invalid' }, { edit: { ...edit, exposure: 999 } },
    { edit: { ...edit, masks: 'invalid' } }, { edit: { ...edit, denoise: -1 } },
    { framing: { ...framing, turns: 0.5 } }, { framing: null },
    { focusPoint: { x: 0.5, y: 2 } }, { focusPoint: [0.5, 0.5] },
    { subjectKind: 'unknown' },
  ]) {
    assert.equal(parseSnapshot(JSON.stringify({ ...snapshot, photos: [snapshot.photos[0], { ...row, ...patch }] })), null);
  }
  const good = { ...snapshot, photos: [snapshot.photos[0], {
    ...row, edit, framing, focusPoint: { x: 0.25, y: 0.75 }, subjectKind: 'wildlife',
  }] };
  assert.deepEqual(parseSnapshot(JSON.stringify(good)), good);
  assert.equal(applySnapshot([frame('b')], parseSnapshot(JSON.stringify(good))!)[0].edit?.exposure, 0);
});

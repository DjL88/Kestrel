import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_EDIT } from './photoEdits';
import { pickForCloud } from './cloudEditsChoice';
import { defaultFinishRequest, planFinish, rankPhotos, requestedCount, starsOf, type FinishCandidate } from './finishPlan';

const shoot = (n: number, patch: (i: number) => Partial<FinishCandidate> = () => ({})): FinishCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, sequenceIndex: i, cullScore: i, ...patch(i) }));
const ids = (items: FinishCandidate[]) => items.map((frame) => frame.id);

test('best first: stars, then cull score, then capture order; unranked photos last', () => {
  const frames: FinishCandidate[] = [
    { id: 'a', sequenceIndex: 0, cullScore: 9 },
    { id: 'b', sequenceIndex: 1, rating: 3, cullScore: 1 },
    { id: 'c', sequenceIndex: 2 },
    { id: 'd', sequenceIndex: 3, cullScore: 9 },
    { id: 'e', sequenceIndex: 4, rating: 5 },
    { id: 'f', sequenceIndex: 5, exif: { rating: 4 } },
  ];
  assert.deepEqual(ids(rankPhotos(frames)), ['e', 'f', 'b', 'a', 'd', 'c']);
});

test('the ranking agrees with the cloud run for stars and scores', () => {
  const frames = shoot(40, (i) => ({ rating: i % 7 === 0 ? 3 : 0 }));
  assert.deepEqual(ids(rankPhotos(frames)), pickForCloud(frames.map((frame) => ({ ...frame, id: frame.id }))).map((frame) => frame.id));
});

test('the photographer\'s own rating beats the camera\'s, including clearing to none', () => {
  assert.equal(starsOf({ rating: 0, exif: { rating: 5 } }), 0);
  assert.equal(starsOf({ exif: { rating: 5 } }), 5);
  assert.equal(starsOf({ rating: 9 }), 0, 'an out-of-range rating is not stars');
});

test('count, percent and all choose the best photos in order', () => {
  const frames = shoot(1000);
  const fifty = planFinish(frames, { kind: 'count', count: 50 });
  assert.equal(fifty.items.length, 50);
  assert.equal(fifty.items[0].id, 'p999');
  assert.deepEqual(fifty.summary, { kind: 'count', chosen: 50, of: 1000, edited: 0, rejected: 0, editedElsewhere: 0, unranked: 0, asked: 50 });
  assert.equal(planFinish(frames, { kind: 'percent', percent: 10 }).items.length, 100);
  assert.equal(planFinish(frames, { kind: 'count', count: 200 }).items.length, 200);
  assert.equal(planFinish(frames, { kind: 'all' }).items.length, 1000);
  assert.equal(planFinish(frames, { kind: 'count', count: 5000 }).items.length, 1000, 'more than there are is every photo');
});

test('a percentage rounds up so a small shoot is never asked for none; bad numbers choose nothing', () => {
  assert.equal(requestedCount({ kind: 'percent', percent: 10 }, 7), 1);
  assert.equal(requestedCount({ kind: 'percent', percent: 250 }, 7), 7);
  assert.equal(requestedCount({ kind: 'count', count: -3 }, 7), 0);
  assert.equal(requestedCount({ kind: 'count', count: Number.NaN }, 7), 0);
  assert.equal(requestedCount({ kind: 'all' }, 0), 0);
  assert.equal(planFinish([], { kind: 'count', count: 50 }).items.length, 0);
});

test('photos already edited, removed, rejected or edited elsewhere are skipped, and counted; nothing slides down to fill', () => {
  const frames = shoot(10, (i) => ({
    ...(i === 9 ? { edit: { ...DEFAULT_EDIT, exposure: 0.4 } } : {}),
    ...(i === 8 ? { removedAt: 5 } : {}),
    ...(i === 7 ? { decision: 'reject' } : {}),
    ...(i === 6 ? { exif: { editStatus: { kind: 'edited-elsewhere' } } } : {}),
    ...(i === 5 ? { editHistory: { steps: [{}] } } : {}),
  }));
  const plan = planFinish(frames, { kind: 'count', count: 5 });
  // The best five of the nine still in the project are p9, p7, p6, p5, p4: only p4 is left to finish.
  assert.deepEqual(ids(plan.items), ['p4']);
  assert.deepEqual({ ...plan.summary }, { kind: 'count', chosen: 1, of: 9, edited: 2, rejected: 1, editedElsewhere: 1, unranked: 0, asked: 5 });
  const bigger = planFinish(frames, { kind: 'count', count: 9 });
  assert.deepEqual(ids(bigger.items), ['p4', 'p3', 'p2', 'p1', 'p0']);
});

test('an empty recipe is not an edit', () => {
  const plan = planFinish(shoot(3, () => ({ edit: { ...DEFAULT_EDIT } })), { kind: 'all' });
  assert.equal(plan.items.length, 3);
});

test('best N never guesses an unranked photo in; all takes it, last', () => {
  const frames: FinishCandidate[] = [{ id: 'a', sequenceIndex: 0, cullScore: 2 }, { id: 'b', sequenceIndex: 1 }, { id: 'c', sequenceIndex: 2, rating: 4 }];
  const best = planFinish(frames, { kind: 'count', count: 3 });
  assert.deepEqual(ids(best.items), ['c', 'a']);
  assert.equal(best.summary.unranked, 1);
  assert.deepEqual(ids(planFinish(frames, { kind: 'all' }).items), ['c', 'a', 'b']);
});

test('the default is 50 photos or 10%, whichever is smaller', () => {
  assert.deepEqual(defaultFinishRequest(1000), { kind: 'count', count: 50 });
  assert.deepEqual(defaultFinishRequest(300), { kind: 'percent', percent: 10 });
  assert.deepEqual(defaultFinishRequest(500), { kind: 'count', count: 50 });
  assert.deepEqual(defaultFinishRequest(20), { kind: 'percent', percent: 10 });
  assert.deepEqual(defaultFinishRequest(0), { kind: 'count', count: 50 });
});

test('the plan never changes the photos it was given', () => {
  const frames = shoot(5);
  const before = JSON.stringify(frames);
  planFinish(frames, { kind: 'all' });
  assert.equal(JSON.stringify(frames), before);
});

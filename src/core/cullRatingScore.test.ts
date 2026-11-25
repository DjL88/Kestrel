import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCullRatingReport, scoreCullAgainstRatings, type PhotographerRating } from './cullRatingScore.ts';
import type { PhotoFrame } from './types.ts';

// Synthetic frames and ratings only.
const frame = (id: string, filename: string, extra: Partial<PhotoFrame> = {}) =>
  ({ id, filename, decision: 'unreviewed', exif: {}, isDemo: false, ...extra }) as unknown as PhotoFrame;

const frames = [
  frame('1', 'DSC_0001.NEF', { decision: 'keep', cullConfidence: 'high', cullScore: 90 }),
  frame('2', 'DSC_0002.NEF', { decision: 'reject', cullConfidence: 'high', cullScore: 10 }),
  frame('3', 'DSC_0003.NEF', { decision: 'reject', cullConfidence: 'medium', cullScore: 20 }),
  frame('4', 'DSC_0004.NEF', { decision: 'unreviewed', cullConfidence: 'low', cullScore: 50 }),
  frame('5', 'DSC_0005.NEF', { decision: 'reject', exif: { rejectedByMetadata: true } as PhotoFrame['exif'] }),
  frame('6', 'DSC_0006.NEF'),
  frame('7', 'DSC_0007.NEF', { decision: 'keep', cullConfidence: 'high', cullScore: 80 }),
];
const ratings = new Map<string, PhotographerRating>([
  ['dsc_0001.nef', { stars: 4 }], ['DSC_0002.NEF', { stars: 0 }], ['DSC_0003.NEF', { stars: 5 }],
  ['DSC_0004.NEF', { stars: 3 }], ['DSC_0005.NEF', { rejected: true }], ['DSC_0007.NEF', { stars: 1 }],
]);

test('joins the photographer\'s stars with Auto-Cull\'s decisions, by file name', () => {
  const report = scoreCullAgainstRatings(frames, ratings);
  assert.equal(report.result.total, 6);
  assert.equal(report.result.favourites, 3);
  assert.equal(report.result.foundFavourites, 2, 'the undecided favourite counts as kept for review');
  assert.deepEqual(report.rejectedFavourites, ['DSC_0003.NEF']);
  assert.deepEqual(report.unsureRejections, ['DSC_0003.NEF'], 'a medium-confidence reject breaks the rule');
  assert.deepEqual(report.unrated, ['DSC_0006.NEF'], 'never guessed');
  assert.equal(report.rejectedBeforeImport, 1, 'the person\'s own reject is not an Auto-Cull prediction');
  assert.equal(report.result.autoKeeps, 2);
  assert.equal(report.result.correctAutoKeeps, 1);
  assert.match(describeCullRatingReport(report), /2 of 3/);
});

test('a higher star bar changes who counts as a favourite', () => {
  const report = scoreCullAgainstRatings(frames, ratings, { favouriteStars: 5 });
  assert.equal(report.result.favourites, 1);
});

test('ambiguous or malformed input is refused', () => {
  assert.throws(() => scoreCullAgainstRatings([...frames, frame('8', 'dsc_0001.nef')], ratings), /Two photos/);
  assert.throws(() => scoreCullAgainstRatings(frames, new Map([['a', { stars: 7 }]])), /stars/);
  assert.throws(() => scoreCullAgainstRatings(frames, new Map([['A', {}], ['a', {}]])), /Two ratings/);
  assert.throws(() => scoreCullAgainstRatings(frames, new Map([['other.jpg', { stars: 5 }]])), /No rated photos/);
  assert.throws(() => scoreCullAgainstRatings(frames, ratings, { favouriteStars: 0 }), /1 to 5/);
});

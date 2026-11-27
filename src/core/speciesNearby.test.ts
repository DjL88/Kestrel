import test from 'node:test';
import assert from 'node:assert/strict';
import { GUESS_FLOOR, NEARBY_MS, keepGuess, sameMoment, shareNearbySpecies } from './speciesNearby';
import type { PhotoFrame } from './types';

const T0 = Date.UTC(2026, 10, 27, 9, 0, 0);
type F = Parameters<typeof shareNearbySpecies>[0][number];
const photo = (id: string, seconds: number, extra: Partial<PhotoFrame> = {}): F => ({
  id, subjectKind: 'wildlife', exif: { camera: 'NIKON Z5_2', capturedAtMs: T0 + seconds * 1000 }, burstGroupId: null, ...extra,
}) as F;
const sure = (id: string, seconds: number, name = 'Common Kingfisher') => photo(id, seconds, { tags: [name], autoTags: [name] });
const guessing = (id: string, seconds: number, probability: number, name = 'Common Kingfisher') =>
  photo(id, seconds, { tags: ['Bird'], speciesGuess: { name, probability } });

test("Dave's example: five shots of 70% kingfisher beside two sure ones all become kingfisher suggestions", () => {
  const frames = [sure('a', 0), sure('b', 3), ...[5, 8, 12, 20, 40].map((s, i) => guessing(`g${i}`, s, 0.7))];
  const next = shareNearbySpecies(frames);
  for (const frame of next.slice(2)) {
    assert.ok(frame.tags?.includes('Common Kingfisher'));
    assert.ok(frame.autoTags?.includes('Common Kingfisher'), 'stays an automatic suggestion the person can remove');
    assert.equal(frame.speciesNearby, true);
  }
  assert.equal(next[0], frames[0], 'sure photos are left exactly as they were');
});

test('a low guess is never lifted, even right beside a sure photo', () => {
  const frames = [sure('a', 0), guessing('low', 2, GUESS_FLOOR - 0.01)];
  assert.equal(shareNearbySpecies(frames), frames);
  assert.equal(keepGuess({ name: 'Common Kingfisher', probability: 0.3 }), undefined, 'a low guess is not even kept');
});

test('a different species guess is not overwritten by a sure neighbour', () => {
  const frames = [sure('a', 0), guessing('dipper', 5, 0.8, 'White-throated Dipper')];
  assert.equal(shareNearbySpecies(frames), frames);
});

test('sure neighbours that disagree share nothing', () => {
  const frames = [sure('a', 0), sure('b', 10, 'White-throated Dipper'), guessing('g', 5, 0.75)];
  assert.equal(shareNearbySpecies(frames), frames);
});

test('only the same moment counts: same camera within two minutes, or the same burst', () => {
  assert.equal(shareNearbySpecies([sure('a', 0), guessing('late', NEARBY_MS / 1000 + 1, 0.9)])[1].speciesNearby, undefined);
  const other = { ...guessing('other', 5, 0.9), exif: { camera: 'Canon EOS R7', capturedAtMs: T0 + 5000 } } as F;
  assert.equal(shareNearbySpecies([sure('a', 0), other])[1].speciesNearby, undefined, 'another camera is another photographer');
  const noClock = { ...guessing('noclock', 5, 0.9), exif: { camera: 'NIKON Z5_2' } } as F;
  assert.equal(sameMoment(sure('a', 0), noClock), false, 'an unknown time is not the same moment');
  const burst = [{ ...sure('a', 0), burstGroupId: 'b1', exif: { camera: 'NIKON Z5_2' } }, { ...noClock, burstGroupId: 'b1' }] as F[];
  assert.equal(shareNearbySpecies(burst)[1].speciesNearby, true, 'one burst is one moment even without times');
  const split = [burst[0], { ...burst[1], burstUngrouped: true }] as F[];
  assert.equal(shareNearbySpecies(split), split, 'a burst the person split apart is not one moment');
});

test("a name the person turned down, a disputed subject or a removed photo never takes the name", () => {
  const declined = { ...guessing('d', 5, 0.9), declinedTags: ['Common Kingfisher'] } as F;
  const disputed = { ...guessing('x', 6, 0.9), subjectDisputed: true } as F;
  const removed = { ...guessing('r', 7, 0.9), removedAt: 1 } as F;
  const frames = [sure('a', 0), declined, disputed, removed];
  assert.equal(shareNearbySpecies(frames), frames);
});

test('a shared name never confirms another photo in turn, and a name of the person\'s own is never replaced', () => {
  const shared = { ...photo('s', 0, { tags: ['Common Kingfisher'], autoTags: ['Common Kingfisher'] }), speciesNearby: true } as F;
  const frames = [shared, guessing('g', 60, 0.8)];
  assert.equal(shareNearbySpecies(frames), frames, 'no chains: only sure photos confirm');
  const own = photo('own', 5, { tags: ['Bird', 'Kingfisher'], speciesGuess: { name: 'Common Kingfisher', probability: 0.9 } });
  const mine = [sure('a', 0), own];
  assert.equal(shareNearbySpecies(mine), mine);
});

test('a person-named photo counts as sure, and kind words like Bird neither confirm nor block', () => {
  const named = photo('n', 0, { subjectNames: ['Common Kingfisher'] });
  const bird = photo('bird', 1, { tags: ['Bird'] });
  const next = shareNearbySpecies([named, bird, guessing('g', 4, 0.65)]);
  assert.equal(next[2].speciesNearby, true);
  assert.deepEqual(next[2].tags, ['Bird', 'Common Kingfisher']);
});

test('nothing sure, or malformed guesses: the same array comes back', () => {
  const frames = [guessing('a', 0, 0.9), guessing('b', 1, 0.9)];
  assert.equal(shareNearbySpecies(frames), frames);
  assert.equal(keepGuess({ name: ' ', probability: 0.9 }), undefined);
  assert.equal(keepGuess({ name: 'Common Kingfisher', probability: Number.NaN }), undefined);
  assert.equal(keepGuess({ name: 'Common Kingfisher', probability: 1.2 }), undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROSSFADE_MS, SLIDE_MS, SLIDESHOW_LIMIT, asSlideshowSnapshot, nextSlide, pickSlideshowPhotos, slideshowWanted, type SlideshowFrame,
} from './welcomeSlideshow';

const frame = (id: string, decision: SlideshowFrame['decision'], extra: Partial<SlideshowFrame> = {}): SlideshowFrame =>
  ({ id, stableKey: `key-${id}`, decision, ...extra });

test('the timing is a slow crossfade: about 6 s a photo with a 1 s fade, through at most 8', () => {
  assert.equal(SLIDE_MS, 6000);
  assert.equal(CROSSFADE_MS, 1000);
  assert.equal(SLIDESHOW_LIMIT, 8);
});

test('pickSlideshowPhotos: only flagged photos, in the project order', () => {
  const frames = [frame('a', 'keep'), frame('b', 'unreviewed'), frame('c', 'reject'), frame('d', 'keep'), frame('e', 'keep')];
  assert.deepEqual(pickSlideshowPhotos(frames).map((f) => f.id), ['a', 'd', 'e']);
});

test('pickSlideshowPhotos: removed photos and virtual copies are never chosen', () => {
  const frames = [
    frame('a', 'keep', { removedAt: 123 }),
    frame('b', 'keep'),
    frame('b2', 'keep', { stableKey: 'key-b', virtualCopy: { originalFrameId: 'b', number: 2 } }),
    frame('c', 'keep', { removedAt: null }),
  ];
  assert.deepEqual(pickSlideshowPhotos(frames).map((f) => f.id), ['b', 'c']);
});

test('pickSlideshowPhotos: one picture per original, even if two frames share it', () => {
  const frames = [frame('a', 'keep'), frame('a-again', 'keep', { stableKey: 'key-a' }), frame('b', 'keep')];
  assert.deepEqual(pickSlideshowPhotos(frames).map((f) => f.id), ['a', 'b']);
});

test('pickSlideshowPhotos: no flagged photos gives nothing, so the slideshow stays hidden', () => {
  assert.deepEqual(pickSlideshowPhotos([frame('a', 'unreviewed'), frame('b', 'reject')]), []);
  assert.deepEqual(pickSlideshowPhotos([]), []);
});

test('pickSlideshowPhotos: more flagged photos than the limit are spread evenly across the whole shoot, first one included', () => {
  const frames = Array.from({ length: 20 }, (_, i) => frame(String(i), 'keep'));
  const picked = pickSlideshowPhotos(frames).map((f) => Number(f.id));
  assert.equal(picked.length, 8);
  assert.deepEqual(picked, [0, 2, 5, 7, 10, 12, 15, 17]);
  assert.deepEqual(pickSlideshowPhotos(frames, 3).map((f) => Number(f.id)), [0, 6, 13]);
});

test('pickSlideshowPhotos: a limit of zero or less, or not a number, gives nothing', () => {
  const frames = [frame('a', 'keep')];
  assert.deepEqual(pickSlideshowPhotos(frames, 0), []);
  assert.deepEqual(pickSlideshowPhotos(frames, -2), []);
  assert.deepEqual(pickSlideshowPhotos(frames, Number.NaN), []);
});

test('slideshowWanted: welcome back only, not turned off, with photos to show', () => {
  assert.equal(slideshowWanted({ state: 'signedIn', off: false, slides: 3 }), true);
  assert.equal(slideshowWanted({ state: 'guest', off: false, slides: 1 }), true);
  assert.equal(slideshowWanted({ state: 'first', off: false, slides: 3 }), false);
  assert.equal(slideshowWanted({ state: 'signedIn', off: true, slides: 3 }), false);
  assert.equal(slideshowWanted({ state: 'guest', off: false, slides: 0 }), false);
});

test('nextSlide: moves on and wraps round; with reduced motion, or one photo, it stays still', () => {
  assert.equal(nextSlide(0, 3, false), 1);
  assert.equal(nextSlide(2, 3, false), 0);
  assert.equal(nextSlide(1, 3, true), 1);
  assert.equal(nextSlide(0, 1, false), 0);
  assert.equal(nextSlide(5, 3, false), 0);
});

test('asSlideshowSnapshot: accepts a well-formed snapshot', () => {
  const value = { projectId: 'p1', projectName: 'Kestrels at dawn', developVersion: 3, keys: ['k1', 'k2'] };
  assert.deepEqual(asSlideshowSnapshot(value), value);
});

test('asSlideshowSnapshot: rejects anything malformed, oversized or empty', () => {
  const ok = { projectId: 'p1', projectName: 'Dawn', developVersion: 3, keys: ['k1'] };
  for (const bad of [
    null, 'text', 42, [],
    { ...ok, projectId: 7 },
    { ...ok, projectName: null },
    { ...ok, developVersion: 1.5 },
    { ...ok, keys: 'k1' },
    { ...ok, keys: [] },
    { ...ok, keys: ['k1', 3] },
    { ...ok, keys: Array.from({ length: 9 }, (_, i) => `k${i}`) },
    { ...ok, keys: ['x'.repeat(2049)] },
    { ...ok, projectName: 'x'.repeat(501) },
  ]) assert.equal(asSlideshowSnapshot(bad), null, JSON.stringify(bad)?.slice(0, 80));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROSSFADE_MS, PRELOAD_MS, SLIDE_MS, SLIDESHOW_LIMIT, asSlideshowSnapshot, pickResumePhotos, pickSlideshowPhotos, runSlideshow, slideshowDots, slideshowForProject,
  slideshowWanted, type SlideshowFrame, type SlideshowView,
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

test('slideshowForProject: shown only for the project the welcome offers to pick up', () => {
  const snapshot = { projectId: 'p1', projectName: 'Dawn', developVersion: 3, keys: ['k1'] };
  assert.equal(slideshowForProject(snapshot, 'p1'), snapshot);
  assert.equal(slideshowForProject(snapshot, 'p2'), null);
  assert.equal(slideshowForProject(snapshot, null), snapshot, 'no remembered project: nothing to disagree with');
  assert.equal(slideshowForProject(null, 'p1'), null);
});

/** A fake clock and preview reader for the slideshow runner, recording what is read, shown and let go. */
function harness(available: boolean[]) {
  let clock = 0;
  let alive = true;
  const reads: number[] = [];
  const live = new Set<string>();
  const views: SlideshowView[] = [];
  let maxLive = 0;
  const deps = {
    count: available.length,
    prepare: async (index: number) => {
      reads.push(index);
      if (!available[index]) return null;
      const url = `blob:${index}:${reads.length}`;
      live.add(url);
      maxLive = Math.max(maxLive, live.size);
      return url;
    },
    release: (url: string) => { live.delete(url); },
    wait: async (ms: number) => { clock += ms; if (clock > 60_000) alive = false; },
    now: () => clock,
    alive: () => alive,
    update: (view: SlideshowView) => { views.push(view); },
  };
  return { deps, reads, live, views, get maxLive() { return maxLive; }, stop: () => { alive = false; } };
}

test('runSlideshow: with reduced motion it reads one preview only and shows it still', async () => {
  const h = harness([true, true, true]);
  await runSlideshow({ ...h.deps, reduced: true });
  assert.deepEqual(h.reads, [0]);
  assert.equal(h.views.length, 1);
  assert.equal(h.views[0].shown?.index, 0);
  assert.equal(h.views[0].incoming, null);
});

test('runSlideshow: reads each next photo just in time, keeps at most two alive, and lets each go once it has left', async () => {
  const h = harness([true, true, true]);
  await runSlideshow({ ...h.deps, reduced: false });
  assert.ok(h.maxLive <= 2, `at most two pictures held, saw ${h.maxLive}`);
  assert.ok(h.live.size <= 2);
  // The first is read at once; each later one only after the photo before it has shown for a while.
  assert.equal(h.reads[0], 0);
  assert.deepEqual(h.reads.slice(0, 4), [0, 1, 2, 0]);
  const shown = h.views.map((view) => view.shown?.index);
  assert.deepEqual([...new Set(shown)].slice(0, 3), [0, 1, 2]);
  // The crossfade: the incoming photo is mounted first, then fades in.
  const firstIncoming = h.views.findIndex((view) => view.incoming);
  assert.equal(h.views[firstIncoming].fading, false);
  assert.equal(h.views[firstIncoming + 1].fading, true);
  assert.equal(SLIDE_MS - CROSSFADE_MS - PRELOAD_MS > 0, true);
});

test('runSlideshow: a preview that cannot be read is skipped, and a single readable photo stays still', async () => {
  const h = harness([false, true, false]);
  await runSlideshow({ ...h.deps, reduced: false });
  assert.equal(h.views[0].shown?.index, 1);
  assert.ok(h.views.every((view) => view.incoming === null), 'never crossfades to itself');
  assert.deepEqual(h.views.at(-1)?.missing, [0, 2]);
  assert.equal(h.views.at(-1)?.moved, false);
});

test('runSlideshow: nothing readable shows nothing', async () => {
  const h = harness([false, false]);
  await runSlideshow({ ...h.deps, reduced: false });
  assert.equal(h.views.at(-1)?.shown ?? null, null);
  assert.equal(h.live.size, 0);
});

test('slideshowDots: one dot per readable photo, the showing one marked', () => {
  const view: SlideshowView = { shown: { index: 3, url: 'u' }, incoming: null, fading: false, missing: [1], moved: true };
  assert.deepEqual(slideshowDots(view, 4), { count: 3, current: 2 });
  assert.deepEqual(slideshowDots({ ...view, shown: null }, 4), { count: 3, current: 0 });
});

test('pickResumePhotos: flagged first, then the rest in order, never removed or virtual copies, at most three', () => {
  const frame = (id: string, over: Record<string, unknown> = {}) => ({ id, stableKey: id, decision: 'unreviewed', removedAt: null, virtualCopy: false, ...over });
  const frames = [frame('a'), frame('b', { decision: 'keep' }), frame('c', { removedAt: 1 }), frame('d', { virtualCopy: true }), frame('e'), frame('f')];
  assert.deepEqual(pickResumePhotos(frames as never[]).map((f: { id: string }) => f.id), ['b', 'a', 'e']);
  assert.deepEqual(pickResumePhotos([frame('a')] as never[]).map((f: { id: string }) => f.id), ['a']);
  assert.deepEqual(pickResumePhotos([]), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseGalleryFeedback, type GalleryFeedbackEvent } from './galleryFeedback.ts';

const e = (visitor: string, photoId: string | null, kind: GalleryFeedbackEvent['kind'], atMs: number, text: string | null = null): GalleryFeedbackEvent => ({ visitor, photoId, kind, text, atMs });

test('favourites follow each visitor’s latest choice', () => {
  const s = summariseGalleryFeedback([e('a', 'p1', 'favourite', 1), e('b', 'p1', 'favourite', 2), e('a', 'p1', 'unfavourite', 3)], ['p1', 'p2']);
  assert.equal(s.photos[0].favourites, 1);
  assert.equal(s.photos[1].favourites, 0);
  assert.equal(s.visitors, 2);
});

test('a later request for changes replaces that visitor’s approval, and approve-all covers every photo', () => {
  const s = summariseGalleryFeedback([e('a', null, 'approve-all', 1), e('a', 'p2', 'request-changes', 2, 'Crop tighter'), e('b', 'p2', 'approve', 3)], ['p1', 'p2']);
  assert.deepEqual([s.photos[0].approvals, s.photos[0].changeRequests], [1, 0]);
  assert.deepEqual([s.photos[1].approvals, s.photos[1].changeRequests], [1, 1]);
  assert.deepEqual(s.photos[1].notes, [{ kind: 'request-changes', text: 'Crop tighter', atMs: 2 }]);
  assert.equal(s.total.approvals, 2);
});

test('events for photos outside the gallery and empty comments are ignored; order is by time', () => {
  const s = summariseGalleryFeedback([e('a', 'p1', 'comment', 5, 'second'), e('a', 'zz', 'favourite', 1), e('a', 'p1', 'comment', 2, '  '), e('a', 'p1', 'comment', 1, 'first')], ['p1']);
  assert.deepEqual(s.photos[0].notes.map((n) => n.text), ['first', 'second']);
  assert.equal(s.total.favourites, 0);
});

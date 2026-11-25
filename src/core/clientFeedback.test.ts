import test from 'node:test';
import assert from 'node:assert/strict';
import { FEEDBACK_ITEM_ID, feedbackItemId, flagFor, lastActivity, reviewOrder, reviewState } from './clientFeedback';
import { summariseGalleryFeedback, type GalleryFeedbackEvent } from './galleryFeedback';

const ev = (visitor: string, kind: GalleryFeedbackEvent['kind'], photoId: string | null, atMs: number, text: string | null = null): GalleryFeedbackEvent => ({ visitor, kind, photoId, text, atMs });

test('each photo with feedback is new until reviewed, and new again when a client acts after the review', () => {
  const events = [ev('a', 'favourite', 'p1', 10), ev('a', 'comment', 'p2', 20, 'Lovely'), ev('b', 'approve-all', null, 30)];
  const last = lastActivity(events, ['p1', 'p2', 'p3']);
  assert.deepEqual(Object.fromEntries(last), { p1: 30, p2: 30, p3: 30 }, 'approve all touches every photo in the gallery');
  const reviewed = [{ itemId: feedbackItemId('p1'), state: 'done' as const, byName: 'Dave', atMs: 40 }];
  assert.deepEqual(reviewState('p1', last, reviewed), { state: 'done', byName: 'Dave' });
  assert.deepEqual(reviewState('p2', last, reviewed), { state: 'new', byName: null });
  const later = lastActivity([...events, ev('c', 'favourite', 'p1', 50)], ['p1', 'p2', 'p3']);
  assert.deepEqual(reviewState('p1', later, reviewed), { state: 'new', byName: null }, 'another client picked it after the review');
  assert.equal(lastActivity([ev('a', 'favourite', 'elsewhere', 5)], ['p1']).size, 0, 'photos outside the gallery are ignored');
  assert.match(feedbackItemId('p_1-x'), FEEDBACK_ITEM_ID);
});

test('feedback never changes a decision by itself: only a client pick can become a flag, when chosen', () => {
  const summary = summariseGalleryFeedback([
    ev('a', 'favourite', 'p1', 1), ev('a', 'approve', 'p2', 2), ev('a', 'comment', 'p3', 3, 'Reject this one'), ev('a', 'request-changes', 'p4', 4, 'Crop'),
    ev('a', 'favourite', 'gone', 5),
  ], ['p1', 'p2', 'p3', 'p4', 'gone']);
  const decisions: Record<string, 'unreviewed' | 'keep' | 'reject'> = { p1: 'unreviewed', p2: 'reject', p3: 'unreviewed', p4: 'unreviewed' };
  const lookup = (id: string) => decisions[id] ?? null;
  assert.deepEqual(summary.photos.map((p) => flagFor(p, lookup)), [
    { photoId: 'p1', decision: 'keep' }, { photoId: 'p2', decision: 'keep' }, null, null, null,
  ]);
  decisions.p1 = 'keep';
  assert.equal(flagFor(summary.photos[0], lookup), null, 'already flagged');
});

test('new items come first, the gallery order kept within each group', () => {
  const rows = [{ id: 'a', state: 'done' as const }, { id: 'b', state: 'new' as const }, { id: 'c', state: 'dismissed' as const }, { id: 'd', state: 'new' as const }];
  assert.deepEqual(reviewOrder(rows).map((r) => r.id), ['b', 'd', 'a', 'c']);
});

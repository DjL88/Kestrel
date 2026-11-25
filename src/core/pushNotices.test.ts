import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPreferences, isPushToken, pushCategory, pushData, pushState, pushTarget } from './pushNotices';

test('a push carries kind and opaque ids only, and drops anything that is not an id', () => {
  assert.deepEqual(pushData({ kind: 'comment', projectId: 'p_1', photoId: 'k-2', id: 'n3' }), { kind: 'comment', projectId: 'p_1', photoId: 'k-2', noticeId: 'n3' });
  assert.deepEqual(pushData({ kind: 'reply', projectId: 'IMG 0001.jpg', photoId: null }), { kind: 'reply' });
});

test('kinds map to the choices people make; product news is its own', () => {
  assert.equal(pushCategory('client-feedback'), 'clientFeedback');
  assert.equal(pushCategory('news'), 'news');
  for (const kind of ['comment', 'reply', 'resolve', 'reopen'] as const) assert.equal(pushCategory(kind), 'comments');
  assert.deepEqual(cleanPreferences({ comments: false, clientFeedback: 'yes', other: true }), { comments: false, clientFeedback: true, news: true });
  assert.deepEqual(cleanPreferences(null), { comments: true, clientFeedback: true, news: true });
  assert.equal(cleanPreferences({ news: false }).news, false);
});

test('tokens are checked before they are stored', () => {
  assert.equal(isPushToken('dGVzdC10b2tlbi0xMjM0NTY3ODkw:APA91bH'), true);
  assert.equal(isPushToken('short'), false);
  assert.equal(isPushToken('has spaces in it, not a token at all'), false);
});

test('the state shown is the one the person can act on, in order', () => {
  const base = { supported: true, configured: true, signedIn: true, permission: 'default' as const, registered: false };
  assert.equal(pushState({ ...base, supported: false }), 'unsupported');
  assert.equal(pushState({ ...base, configured: false }), 'not-configured');
  assert.equal(pushState({ ...base, signedIn: false }), 'signed-out');
  assert.equal(pushState({ ...base, permission: 'denied' }), 'blocked');
  assert.equal(pushState(base), 'off');
  assert.equal(pushState({ ...base, permission: 'granted', registered: true }), 'on');
  assert.equal(pushState({ ...base, permission: 'default', registered: true }), 'off', 'a token without permission is not on');
});

test('a tapped alert opens only a well-formed project and photo', () => {
  assert.deepEqual(pushTarget({ projectId: 'p1', photoId: 'k1' }), { projectId: 'p1', photoId: 'k1' });
  assert.deepEqual(pushTarget({ projectId: 'p1', photoId: '../x' }), { projectId: 'p1', photoId: null });
  assert.equal(pushTarget({ projectId: 'javascript:alert(1)' }), null);
  assert.equal(pushTarget(null), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMENT_MAX_CHARS, COMMENT_MAX_THREADS_PER_PHOTO, cleanCommentText, orderThreads, reopenThread, reply, resolveThread, startThread, threadVisibleTo, validPin,
  type CommentThread,
} from './photoComments';

const start = (over: Partial<Parameters<typeof startThread>[0]> = {}, atMs = 1000) => {
  const r = startThread({ id: 't1', entryId: 'e1', photoId: 'p1', pin: { x: 0.25, y: 0.75 }, authorAccountId: 'a', authorName: 'Ann', text: 'Eye is soft', ...over }, 0, atMs);
  assert.equal(r.ok, true);
  return (r as { thread: CommentThread }).thread;
};

test('a thread is pinned to a relative point on the photo, or to the whole photo', () => {
  assert.deepEqual(start().pin, { x: 0.25, y: 0.75 });
  assert.equal(start({ pin: null }).pin, null);
  for (const pin of [{ x: -0.1, y: 0.5 }, { x: 0.5, y: 1.2 }, { x: Number.NaN, y: 0 }, { x: '0.5', y: 0.5 }, 'centre']) {
    assert.deepEqual(startThread({ id: 't', entryId: 'e', photoId: 'p', pin, authorAccountId: 'a', authorName: 'A', text: 'x' }, 0, 1), { ok: false, reason: 'bad-pin' });
  }
  assert.equal(validPin({ x: 0, y: 1 }), true);
  const extra = startThread({ id: 't', entryId: 'e', photoId: 'p', pin: { x: 0.1, y: 0.2, z: 9 }, authorAccountId: 'a', authorName: 'A', text: 'x' }, 0, 1);
  assert.deepEqual(extra.ok && extra.thread.pin, { x: 0.1, y: 0.2 }, 'nothing but x and y is kept');
});

test('text is trimmed, never empty and never over the limit', () => {
  assert.deepEqual(cleanCommentText('  hi\r\nthere \u0007 '), { ok: true, text: 'hi\nthere' });
  assert.deepEqual(cleanCommentText('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(cleanCommentText('x'.repeat(COMMENT_MAX_CHARS + 1)), { ok: false, reason: 'too-long' });
  assert.equal(cleanCommentText('x'.repeat(COMMENT_MAX_CHARS)).ok, true);
  assert.deepEqual(startThread({ id: 't', entryId: 'e', photoId: 'p', pin: null, authorAccountId: 'a', authorName: 'A', text: 'x' }, COMMENT_MAX_THREADS_PER_PHOTO, 1), { ok: false, reason: 'photo-full' });
});

test('resolve and reopen keep every reply; replying to a resolved thread reopens it', () => {
  const thread = start();
  const resolved = resolveThread(thread, { accountId: 'b', name: 'Bo' }, 2000);
  assert.ok(resolved.ok);
  assert.deepEqual(resolved.thread.resolved, { byAccountId: 'b', byName: 'Bo', atMs: 2000 });
  assert.deepEqual(resolveThread(resolved.thread, { accountId: 'b', name: 'Bo' }, 2001), { ok: false, reason: 'already-resolved' });
  const reopened = reopenThread(resolved.thread, 3000);
  assert.ok(reopened.ok);
  assert.equal(reopened.thread.resolved, null);
  assert.equal(reopened.thread.entries.length, 1);
  assert.deepEqual(reopenThread(reopened.thread, 3001), { ok: false, reason: 'not-resolved' });
  const replied = reply(resolved.thread, { id: 'e2', authorAccountId: 'c', authorName: 'Cy', text: 'Still soft on the left' }, 4000);
  assert.ok(replied.ok);
  assert.equal(replied.thread.resolved, null);
  assert.deepEqual(replied.thread.entries.map((e) => e.text), ['Eye is soft', 'Still soft on the left']);
});

test('clients see only threads they started; open threads come first and keep their numbers', () => {
  const team = start({ id: 't1', authorAccountId: 'editor' }, 1);
  const theirs = start({ id: 't2', authorAccountId: 'client' }, 2);
  assert.equal(threadVisibleTo(team, { accountId: 'client', isClient: true }), false);
  assert.equal(threadVisibleTo(theirs, { accountId: 'client', isClient: true }), true);
  assert.equal(threadVisibleTo(theirs, { accountId: 'editor', isClient: false }), true);
  const resolvedFirst = (resolveThread(team, { accountId: 'x', name: 'X' }, 5) as { thread: CommentThread }).thread;
  assert.deepEqual(orderThreads([theirs, resolvedFirst]).map((t) => [t.id, t.number]), [['t2', 2], ['t1', 1]]);
});

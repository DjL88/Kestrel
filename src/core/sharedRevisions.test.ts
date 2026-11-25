import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireLease, EMPTY_LEASE_BOARD } from './photoLease';
import { headOf, publishRevision, publishVirtualCopy, reconcileOfflineDraft, resolveConflict, type RevisionHistory } from './sharedRevisions';

type R = { exposure: number };
const same = (a: R, b: R) => a.exposure === b.exposure;
const empty: RevisionHistory<R> = { photoId: 'p1', revisions: [] };
const leaseFor = (accountId: string, at = 0) => {
  const got = acquireLease(EMPTY_LEASE_BOARD, { photoId: 'p1', accountId, deviceId: 'd', token: 't-' + accountId, baseRevisionId: null }, at);
  assert.ok(got.ok);
  return got.lease;
};

test('a shared save needs the live lease and the current head, never last-write-wins', () => {
  const ann = leaseFor('ann');
  assert.equal(publishRevision(empty, undefined, { id: 'r1', authorAccountId: 'ann', token: 't-ann', baseRevisionId: null, recipe: { exposure: 1 }, atMs: 1 }).ok, false);
  assert.deepEqual(publishRevision(empty, ann, { id: 'r1', authorAccountId: 'bob', token: 't-ann', baseRevisionId: null, recipe: { exposure: 1 }, atMs: 1 }).ok, false);
  const first = publishRevision(empty, ann, { id: 'r1', authorAccountId: 'ann', token: 't-ann', baseRevisionId: null, recipe: { exposure: 1 }, atMs: 1 });
  assert.ok(first.ok);
  assert.deepEqual({ n: first.revision.number, parent: first.revision.parentId }, { n: 1, parent: null });
  const stale = publishRevision(first.history, ann, { id: 'r2', authorAccountId: 'ann', token: 't-ann', baseRevisionId: null, recipe: { exposure: 2 }, atMs: 2 });
  assert.deepEqual(stale.ok ? null : stale.reason, 'stale-base');
  const lapsed = publishRevision(first.history, ann, { id: 'r2', authorAccountId: 'ann', token: 't-ann', baseRevisionId: 'r1', recipe: { exposure: 2 }, atMs: 120_000 });
  assert.deepEqual(lapsed.ok ? null : lapsed.reason, 'lease-lapsed');
});

test('an offline draft fast-forwards when nobody else changed the photo', () => {
  const ann = leaseFor('ann');
  const first = publishRevision(empty, ann, { id: 'r1', authorAccountId: 'ann', token: 't-ann', baseRevisionId: null, recipe: { exposure: 1 }, atMs: 1 });
  assert.ok(first.ok);
  assert.deepEqual(reconcileOfflineDraft(first.history, { photoId: 'p1', authorAccountId: 'ann', baseRevisionId: 'r1', recipe: { exposure: 3 }, savedAtMs: 5 }, same), { kind: 'fast-forward', baseRevisionId: 'r1' });
  assert.equal(reconcileOfflineDraft(first.history, { photoId: 'p1', authorAccountId: 'ann', baseRevisionId: null, recipe: { exposure: 1 }, savedAtMs: 5 }, same).kind, 'already-shared');
});

test('when someone else published meanwhile, both versions are kept and the person chooses', () => {
  const bob = leaseFor('bob', 200_000);
  const theirs = publishRevision(empty, bob, { id: 'r1', authorAccountId: 'bob', token: 't-bob', baseRevisionId: null, recipe: { exposure: -1 }, atMs: 200_001 });
  assert.ok(theirs.ok);
  const draft = { photoId: 'p1', authorAccountId: 'ann', baseRevisionId: null, recipe: { exposure: 2 }, savedAtMs: 150_000 };
  const result = reconcileOfflineDraft(theirs.history, draft, same);
  assert.equal(result.kind, 'conflict');
  if (result.kind !== 'conflict') return;
  assert.deepEqual(result.theirs.map((r) => r.id), ['r1']);
  assert.deepEqual(result.choices, ['keep-mine', 'keep-theirs', 'virtual-copy']);
  assert.deepEqual(resolveConflict(result, 'keep-mine'), { action: 'publish', baseRevisionId: 'r1', recipe: { exposure: 2 } });
  assert.deepEqual(resolveConflict(result, 'keep-theirs'), { action: 'keep-shared', retainedDraft: draft });
  assert.deepEqual(resolveConflict(result, 'virtual-copy'), { action: 'publish-virtual-copy', baseRevisionId: 'r1', recipe: { exposure: 2 }, virtualCopyOf: 'r1' });
});

test('a published virtual copy sits beside the head without moving it', () => {
  const ann = leaseFor('ann');
  const first = publishRevision(empty, ann, { id: 'r1', authorAccountId: 'ann', token: 't-ann', baseRevisionId: null, recipe: { exposure: 1 }, atMs: 1 });
  assert.ok(first.ok);
  const copy = publishVirtualCopy(first.history, ann, { id: 'v1', authorAccountId: 'ann', token: 't-ann', baseRevisionId: 'r1', recipe: { exposure: 4 }, atMs: 2, virtualCopyOf: 'r1' });
  assert.ok(copy.ok);
  assert.equal(copy.history.revisions.length, 2);
  assert.equal(headOf(copy.history)?.id, 'r1');
  assert.equal(copy.revision.virtualCopyOf, 'r1');
});

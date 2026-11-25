import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireLease, clampLeaseSettings, DEFAULT_LEASE_SETTINGS, EMPTY_LEASE_BOARD, heartbeat, leaseStatus, liveLease, overrideLease, releaseLease } from './photoLease';

const req = (photoId: string, accountId: string, deviceId = 'd1', token = `${accountId}-${photoId}`) => ({ photoId, accountId, deviceId, token, baseRevisionId: null });

test('locks are per photo: different people hold different photos at once', () => {
  const a = acquireLease(EMPTY_LEASE_BOARD, req('p1', 'ann'), 0);
  assert.ok(a.ok);
  const b = acquireLease(a.board, req('p2', 'bob'), 0);
  assert.ok(b.ok);
  assert.deepEqual(acquireLease(b.board, req('p1', 'bob'), 1000), { ok: false, reason: 'held', holderAccountId: 'ann', sameAccount: false });
  assert.deepEqual(acquireLease(b.board, req('p1', 'ann', 'laptop'), 1000), { ok: false, reason: 'held', holderAccountId: 'ann', sameAccount: true });
});

test('the same device renews rather than duplicating the lease', () => {
  const a = acquireLease(EMPTY_LEASE_BOARD, req('p1', 'ann'), 0);
  assert.ok(a.ok);
  const again = acquireLease(a.board, req('p1', 'ann'), 5000);
  assert.ok(again.ok);
  assert.equal(again.lease.token, a.lease.token);
  assert.equal(again.lease.lastActivityMs, 5000);
  assert.equal(again.board.audit.length, 1);
});

test('a closed laptop frees the photo after the network expiry, without an administrator', () => {
  const a = acquireLease(EMPTY_LEASE_BOARD, req('p1', 'ann'), 0);
  assert.ok(a.ok);
  assert.equal(liveLease(a.board, 'p1', 119_999)?.holderAccountId, 'ann');
  assert.equal(liveLease(a.board, 'p1', 120_000), undefined);
  const bob = acquireLease(a.board, req('p1', 'bob'), 120_000);
  assert.ok(bob.ok);
  assert.deepEqual(bob.board.audit.map((e) => e.action), ['acquired', 'expired', 'acquired']);
  assert.equal(bob.board.audit[1].reason, 'network');
  assert.deepEqual(heartbeat(bob.board, 'p1', a.lease.token, 120_001, true), { ok: false, reason: 'not-held' });
});

test('heartbeats keep the connection alive; only editing or background work resets inactivity', () => {
  let board = EMPTY_LEASE_BOARD;
  const a = acquireLease(board, req('p1', 'ann'), 0);
  assert.ok(a.ok);
  board = a.board;
  for (let t = 30_000; t <= 8 * 60_000; t += 30_000) {
    const beat = heartbeat(board, 'p1', a.lease.token, t, false);
    assert.ok(beat.ok);
    board = beat.board;
  }
  const lease = board.leases.p1;
  assert.deepEqual(leaseStatus(lease, 8 * 60_000), { state: 'idle-warning', releasesAtMs: 10 * 60_000 });
  assert.deepEqual(leaseStatus({ ...lease, lastHeartbeatMs: 10 * 60_000 }, 10 * 60_000), { state: 'expired', cause: 'inactive' });
  const working = heartbeat(board, 'p1', a.lease.token, 8 * 60_000 + 1, true);
  assert.ok(working.ok);
  assert.deepEqual(leaseStatus(working.board.leases.p1, 10 * 60_000), { state: 'active' });
});

test('an idle holder who is still connected is released after ten minutes', () => {
  const a = acquireLease(EMPTY_LEASE_BOARD, req('p1', 'ann'), 0);
  assert.ok(a.ok);
  const lease = { ...a.lease, lastHeartbeatMs: 10 * 60_000 };
  assert.deepEqual(leaseStatus(lease, 10 * 60_000), { state: 'expired', cause: 'inactive' });
});

test('check-in and release need the token; an override needs a reason and is audited', () => {
  const a = acquireLease(EMPTY_LEASE_BOARD, req('p1', 'ann'), 0);
  assert.ok(a.ok);
  assert.deepEqual(releaseLease(a.board, 'p1', 'wrong', 1, 'checked-in'), { ok: false, reason: 'not-held' });
  const done = releaseLease(a.board, 'p1', a.lease.token, 1, 'checked-in');
  assert.ok(done.ok);
  assert.equal(done.board.leases.p1, undefined);
  assert.deepEqual(overrideLease(a.board, 'p1', 'own', '  ', 2), { ok: false, reason: 'reason-required' });
  const forced = overrideLease(a.board, 'p1', 'own', 'Ann is on holiday', 2);
  assert.ok(forced.ok);
  assert.deepEqual(forced.board.audit.at(-1), { atMs: 2, photoId: 'p1', action: 'overridden', actorAccountId: 'own', holderAccountId: 'ann', reason: 'Ann is on holiday' });
});

test('owner timings are clamped to stay coherent', () => {
  assert.deepEqual(clampLeaseSettings({}), DEFAULT_LEASE_SETTINGS);
  const odd = clampLeaseSettings({ heartbeatMs: 60_000, networkExpiryMs: 10_000, inactivityReleaseMs: 120_000, inactivityWarningMs: 500_000 });
  assert.equal(odd.networkExpiryMs, 120_000);
  assert.ok(odd.inactivityWarningMs < odd.inactivityReleaseMs);
});

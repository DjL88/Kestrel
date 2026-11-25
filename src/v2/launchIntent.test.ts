import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lastProjectFrom, onLaunchIntent, requestLaunch, resolveLaunchIntent, takeLaunchIntent } from './launchIntent';

test('a project intent opens that project when it exists', () => {
  assert.deepEqual(resolveLaunchIntent({ kind: 'project', id: 'a' }, ['a', 'b']), { open: 'a', notice: null });
});

test('a project that is gone is never guessed at: stay on the hub and say so', () => {
  assert.deepEqual(resolveLaunchIntent({ kind: 'project', id: 'gone' }, ['a']), { open: null, notice: 'missing-project' });
});

test('the projects intent stays on the hub without a notice', () => {
  assert.deepEqual(resolveLaunchIntent({ kind: 'projects' }, []), { open: null, notice: null });
});

test('a requested intent is taken once, then it is gone', () => {
  requestLaunch({ kind: 'project', id: 'a' });
  assert.deepEqual(takeLaunchIntent(), { kind: 'project', id: 'a' });
  assert.equal(takeLaunchIntent(), null);
});

test('listeners hear a request and can stop listening', () => {
  let heard = 0;
  const off = onLaunchIntent(() => { heard += 1; });
  requestLaunch({ kind: 'projects' });
  assert.equal(heard, 1);
  off();
  requestLaunch({ kind: 'projects' });
  assert.equal(heard, 1);
  takeLaunchIntent();
});

test('the last-project snapshot carries an ISO edited date', () => {
  const ts = Date.UTC(2026, 10, 25, 9, 30);
  assert.deepEqual(lastProjectFrom({ id: 'a', name: 'Dawn', photoCount: 12, lastUpdatedAt: ts }), { id: 'a', name: 'Dawn', photoCount: 12, editedAt: new Date(ts).toISOString() });
});

test('an unusable timestamp gives no snapshot rather than throwing', () => {
  assert.equal(lastProjectFrom({ id: 'a', name: 'Dawn', photoCount: 12, lastUpdatedAt: NaN }), null);
});

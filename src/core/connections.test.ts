import assert from 'node:assert/strict';
import test from 'node:test';
import { choosable, cleanLocations, describeLocations, healthFromFailure, newConnectionId, PROVIDERS, type Connection, type HealthReport } from './connections.ts';

const work: Connection = { id: 'w', kind: 'folder', label: 'Work shared drive', detail: 'Shared' };
const home: Connection = { id: 'h', kind: 's3', label: 'Home NAS', detail: 'photos' };
const report = (health: HealthReport['health']): HealthReport => ({ health, message: '', checkedAt: 1 });

test('a failed request becomes a health the person can act on', () => {
  assert.equal(healthFromFailure({ status: 401 }), 'needs-signin');
  assert.equal(healthFromFailure({ status: 403 }), 'needs-signin');
  assert.equal(healthFromFailure({ network: true }), 'offline');
  assert.equal(healthFromFailure({ status: 404 }), 'missing');
  assert.equal(healthFromFailure({ missing: true }), 'missing');
  assert.equal(healthFromFailure({ status: 500 }), 'error');
});

test('a project never keeps a location whose connection was deleted', () => {
  assert.deepEqual(cleanLocations({ loadFrom: 'w', saveTo: 'gone', backUpTo: 'h' }, [work, home]), { loadFrom: 'w', backUpTo: 'h' });
  assert.deepEqual(cleanLocations(undefined, [work]), {});
  assert.deepEqual(cleanLocations({ saveTo: 'w' }, []), {});
});

test('working connections are offered first, broken ones last', () => {
  const order = choosable([work, home], { w: report('needs-signin'), h: report('ok') }).map((c) => c.id);
  assert.deepEqual(order, ['h', 'w']);
  assert.deepEqual(choosable([home, work], {}).map((c) => c.id), ['h', 'w'], 'unchecked ones sort by name');
});

test('a project describes where it lives, and says when a place needs attention', () => {
  const lines = describeLocations({ loadFrom: 'w', backUpTo: 'h' }, [work, home], { w: report('ok'), h: report('offline') });
  assert.deepEqual(lines, ['Load from: Work shared drive', 'Save to: this device only', 'Back up to: Home NAS (Offline)']);
});

test('only folders and S3 storage are ready; Dropbox and Google Drive are listed as coming', () => {
  assert.deepEqual(PROVIDERS.filter((p) => p.available).map((p) => p.kind), ['folder', 's3']);
  assert.ok(PROVIDERS.filter((p) => !p.available).every((p) => p.note));
});

test('new connection ids are distinct', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newConnectionId()));
  assert.equal(ids.size, 200);
});

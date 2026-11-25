import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildInfo } from './buildInfo.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';

test('a stamped release build shows its commit, time and that it is unmodified', () => {
  const info = readBuildInfo({
    VITE_KESTREL_BUILD_REVISION: SHA.slice(0, 12),
    VITE_KESTREL_BUILD_FULL_REVISION: SHA,
    VITE_KESTREL_BUILD_DIRTY: 'false',
    VITE_KESTREL_BUILD_TIMESTAMP: '2026-11-25T10:00:00.000Z',
  });
  assert.deepEqual(info, { revision: SHA.slice(0, 12), fullRevision: SHA, modified: false, builtAt: '2026-11-25T10:00:00.000Z' });
});

test('a build from a changed tree says so', () => {
  assert.equal(readBuildInfo({ VITE_KESTREL_BUILD_FULL_REVISION: SHA, VITE_KESTREL_BUILD_DIRTY: 'true' }).modified, true);
});

test('unknown or malformed values show as unavailable, never as a made-up commit', () => {
  assert.deepEqual(readBuildInfo({}), { revision: null, fullRevision: null, modified: false, builtAt: null });
  const bad = readBuildInfo({ VITE_KESTREL_BUILD_REVISION: 'unavailable', VITE_KESTREL_BUILD_FULL_REVISION: 'main', VITE_KESTREL_BUILD_TIMESTAMP: 'yesterday' });
  assert.equal(bad.revision, null);
  assert.equal(bad.fullRevision, null);
  assert.equal(bad.builtAt, null);
});

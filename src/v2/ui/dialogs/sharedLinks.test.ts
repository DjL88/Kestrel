import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { markOwnCloudProject, readCollabLink, readSharedLink, writeSharedLink } from './sharedLinks';

const data = new Map<string, string>();
beforeEach(() => {
  data.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
});

test('a shared project is live-synced', () => {
  writeSharedLink('local-1', 'srv-1');
  assert.equal(readCollabLink('local-1'), 'srv-1');
});

test('a project stored only for the person\'s own devices is never live-synced', () => {
  writeSharedLink('local-2', 'srv-2');
  markOwnCloudProject('local-2');
  assert.equal(readSharedLink('local-2'), 'srv-2');
  assert.equal(readCollabLink('local-2'), null);
});

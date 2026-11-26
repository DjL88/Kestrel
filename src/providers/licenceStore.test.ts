import { test } from 'node:test';
import assert from 'node:assert/strict';

/** A tiny in-memory Storage, installed before licenceStore loads so every read and write lands here. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

test('leaving the account (also when a grant expires) forgets the launch profile on this device', async () => {
  const g = globalThis as Record<string, unknown>;
  g.localStorage = memoryStorage();
  g.sessionStorage = memoryStorage();
  const { leaveAccount } = await import('./licenceStore');
  const { readProfile, writeProfile } = await import('./launchMemory');
  writeProfile({ signedIn: true, displayName: 'Sam', initial: 'S' }, true);
  writeProfile({ signedIn: true, displayName: 'Sam', initial: 'S' }, false);
  assert.notEqual(readProfile(), null);
  leaveAccount();
  assert.equal(readProfile(), null);
  leaveAccount(); // idempotent, as signOutEverywhere clears it again
  assert.equal(readProfile(), null);
});

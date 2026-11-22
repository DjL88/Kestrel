import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eraseDeviceData, isDeviceKey } from './eraseDeviceData';

function fakeStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() { return map.size; },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
  };
}

test('only InFlight keys are removed, and the catalogue is cleared', async () => {
  const local = fakeStorage({ 'kestrel.lastExport.v1': '1', 'inflight-theme': 'dark', 'other-site': 'keep' });
  let cleared = false;
  const result = await eraseDeviceData({ clearCatalogue: async () => { cleared = true; }, storages: [local] });
  assert.equal(cleared, true);
  assert.equal(result.keysRemoved, 2);
  assert.deepEqual(Array.from(local.map.keys()), ['other-site']);
  assert.deepEqual(result.problems, []);
});

test('a failing catalogue clear is reported, not hidden, and the rest still runs', async () => {
  const local = fakeStorage({ 'kestrel.x': '1' });
  const result = await eraseDeviceData({ clearCatalogue: async () => { throw new Error('boom'); }, storages: [local] });
  assert.equal(result.catalogueCleared, false);
  assert.equal(result.keysRemoved, 1);
  assert.equal(result.problems.length, 1);
});

test('key matching is case-insensitive by prefix only', () => {
  assert.equal(isDeviceKey('Kestrel.abc'), true);
  assert.equal(isDeviceKey('my-kestrel'), false);
});

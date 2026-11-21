import assert from 'node:assert/strict';
import { test } from 'node:test';

test('legacy S3 plaintext is purged and remember cannot persist credentials', async () => {
  const entries = new Map<string, string>([['kestrel.cloud.v1', JSON.stringify({
    endpoint: 'https://storage.example', region: 'eu', bucket: 'photos',
    accessKeyId: 'old-id', secretAccessKey: 'old-secret',
  })]]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return entries.size; },
    key(index: number) { return [...entries.keys()][index] ?? null; },
    getItem(key: string) { return entries.get(key) ?? null; },
    setItem(key: string, value: string) { entries.set(key, value); },
    removeItem(key: string) { entries.delete(key); },
    clear() { entries.clear(); },
  } });
  try {
    const cloud = await import('./cloudSettings');
    assert.equal(entries.has('kestrel.cloud.v1'), false);
    assert.equal(cloud.loadCloudSettings(), null);
    const current = { endpoint: 'https://storage.example', region: 'eu', bucket: 'photos',
      accessKeyId: 'new-id', secretAccessKey: 'new-secret' };
    cloud.saveCloudSettings(current, true);
    assert.deepEqual(cloud.loadCloudSettings(), current);
    assert.equal(cloud.isCloudRemembered(), false);
    assert.equal(entries.has('kestrel.cloud.v1'), false);
    cloud.forgetCloudSettings();
    assert.equal(cloud.loadCloudSettings(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

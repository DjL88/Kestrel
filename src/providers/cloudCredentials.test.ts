import assert from 'node:assert/strict';
import { test } from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

test('cloud settings purge legacy plaintext S3 key and never persist remember requests', async () => {
  const storage = new MemoryStorage();
  storage.setItem('kestrel.cloud.v1', JSON.stringify({ secretAccessKey: 'legacy-secret' }));
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    const cloud = await import('./cloudSettings');
    assert.equal(storage.getItem('kestrel.cloud.v1'), null);
    assert.equal(cloud.loadCloudSettings(), null);
    const settings = { endpoint: 'https://example.test', region: 'eu', bucket: 'photos', accessKeyId: 'id', secretAccessKey: 'session-secret' };
    cloud.saveCloudSettings(settings, true);
    assert.deepEqual(cloud.loadCloudSettings(), settings);
    assert.equal(cloud.isCloudRemembered(), false);
    assert.equal(storage.getItem('kestrel.cloud.v1'), null);
    cloud.forgetCloudSettings();
    assert.equal(cloud.loadCloudSettings(), null);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('connection store purges orphaned legacy credentials and does not persist new S3/WebDAV secrets', async () => {
  const storage = new MemoryStorage();
  storage.setItem('kestrel.connection-keys.v1.orphan', 'old-s3-secret');
  storage.setItem('kestrel.connection-dav.v1.orphan', 'old-dav-secret');
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    const store = await import('./connectionStore');
    assert.equal(storage.getItem('kestrel.connection-keys.v1.orphan'), null);
    assert.equal(storage.getItem('kestrel.connection-dav.v1.orphan'), null);
    store.setS3Keys('one', { endpoint: 'https://example.test', region: 'eu', bucket: 'photos', accessKeyId: 'id', secretAccessKey: 'secret' }, true);
    store.setDavLogin('two', { url: 'https://example.test', username: 'name', password: 'secret' }, true);
    assert.equal(storage.getItem('kestrel.connection-keys.v1.one'), null);
    assert.equal(storage.getItem('kestrel.connection-dav.v1.two'), null);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

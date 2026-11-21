import test from 'node:test';
import assert from 'node:assert/strict';
import { LicenceSync, type KeyValueStorage } from './licenceSync';

const KEY = 'KESTREL1.owned.signed';
function setup(status: 'limit' | 'revoked' | 'unreachable') {
  const values = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key,value) => { values.set(key,value); },
    removeItem: key => { values.delete(key); },
  };
  const reply = async () => {
    if (status === 'unreachable') throw new Error('The control plane is offline');
    return new Response(JSON.stringify({ error: status === 'limit'
      ? { code: 'DEVICE_LIMIT', message: 'All device slots are in use.' }
      : { code: 'LICENCE_NOT_ACTIVE', message: 'This licence has been revoked.' } }),
    { status: status === 'limit' ? 409 : 403, headers: { 'content-type': 'application/json' } });
  };
  const options = {
    baseUrl: 'https://licences.example.test',
    grantKeys: { release: 'fRgITdAJPfCXpyEJ7DZml8316QBUgNlPsc3TPw07ZUw=' },
    storage,
    fetch: reply as unknown as typeof fetch,
    now: () => Date.UTC(2026,10,21),
    platform: 'windows' as const,
    appVersion: '1.0.0',
    randomId: () => 'test-device',
  };
  return { sync: new LicenceSync(options), setStatus: (next: typeof status) => { status = next; },
    reload: () => new LicenceSync(options), values };
}

test('last known device-slot denial stays blocked across restart and connection failure', async () => {
  const env = setup('limit');
  assert.equal((await env.sync.activate(KEY)).kind,'device_limit');
  assert.equal((await env.reload().storedStanding(KEY)).kind,'device_limit');
  env.setStatus('unreachable');
  assert.equal((await env.reload().activate(KEY)).kind,'device_limit');
  env.sync.forget();
  assert.equal((await env.reload().storedStanding(KEY)).kind,'not_checked');
});

test('last known revocation wins over a valid locally stored key when renewal is unreachable', async () => {
  const env = setup('revoked');
  assert.equal((await env.sync.activate(KEY)).kind,'revoked');
  assert.equal((await env.reload().storedStanding(KEY)).kind,'revoked');
  env.setStatus('unreachable');
  assert.equal((await env.reload().activate(KEY)).kind,'revoked');
});

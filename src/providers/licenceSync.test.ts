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

// ---- Account activation: signing in alone grants nothing; a licence on the account does.
import { webcrypto } from 'node:crypto';
import { canonicalJson } from '../core/signedEnvelope';
import { decideAccountAccess } from '../core/licenceOnline';
import { sha256Hex } from '../core/signedEnvelope';

async function accountSetup(mode: 'no_licence' | 'grant' | 'limit' | 'down' | 'badsig') {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const b64 = (b: ArrayBuffer) => Buffer.from(b).toString('base64');
  const grantKeys = { k1: b64(await webcrypto.subtle.exportKey('raw', pair.publicKey)) };
  const values = new Map<string, string>();
  const storage: KeyValueStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } };
  const now = Date.UTC(2026, 10, 21);
  const deviceHash = await sha256Hex(new TextEncoder().encode('kestrel-device:acct-device') as Uint8Array<ArrayBuffer>);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const calls: string[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push(`${url.replace('https://licences.example.test', '')} ${(init.headers as Record<string, string>).authorization ?? ''}`.trim());
    if (mode === 'down') throw new Error('offline');
    if (url.endsWith('/v1/auth/firebase')) return json(200, { accessToken: 'session-token' });
    if (mode === 'no_licence') return json(403, { error: { code: 'NO_LICENCE', message: 'none' } });
    if (mode === 'limit') return json(409, { error: { code: 'DEVICE_LIMIT', message: 'full' } });
    const payload = { schema: 1, grantId: 'grt_abcdefgh', plan: 'paid', managedAi: false, deviceHash, issuedAtMs: now, offlineUntilMs: now + 30 * 86_400_000 };
    const signature = mode === 'badsig' ? 'A'.repeat(86) + '==' : b64(await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(canonicalJson(payload))));
    return json(200, { grant: { payload, keyId: 'k1', signature }, activationId: 'act_1' });
  };
  const options = { baseUrl: 'https://licences.example.test', grantKeys, storage, fetch: fetchImpl as unknown as typeof fetch, now: () => now, platform: 'macos' as const, appVersion: '1.0.0', randomId: () => 'acct-device' };
  return { sync: new LicenceSync(options), reload: () => new LicenceSync(options), calls, now };
}

test('signing in with no licence on the account stays Free', async () => {
  const env = await accountSetup('no_licence');
  const standing = await env.sync.activateAccount('firebase-id-token');
  assert.equal(standing?.kind, 'no_licence');
  assert.deepEqual(env.calls, ['/v1/auth/firebase', '/v1/me/activate Bearer session-token']);
  assert.equal(decideAccountAccess(standing!, env.now).pro, false);
  assert.equal(await env.reload().storedAccountStanding(), null);
});

test('an account with a paid licence gets a verified grant that survives a restart and ends when forgotten', async () => {
  const env = await accountSetup('grant');
  const standing = await env.sync.activateAccount('firebase-id-token');
  assert.equal(standing?.kind, 'active');
  assert.deepEqual(decideAccountAccess(standing!, env.now), { pro: true, managedAi: false, basis: 'grant' });
  assert.equal((await env.reload().storedAccountStanding())?.kind, 'active');
  assert.equal(decideAccountAccess(standing!, env.now + 31 * 86_400_000).pro, false, 'the offline window ends');
  env.sync.forgetAccount();
  assert.equal(await env.reload().storedAccountStanding(), null);
});

test('a device limit, an unreachable server or a forged grant never unlocks Pro', async () => {
  assert.equal((await (await accountSetup('limit')).sync.activateAccount('t'))?.kind, 'device_limit');
  assert.equal(await (await accountSetup('down')).sync.activateAccount('t'), null);
  const forged = await accountSetup('badsig');
  assert.equal(await forged.sync.activateAccount('t'), null);
  assert.equal(await forged.reload().storedAccountStanding(), null);
});

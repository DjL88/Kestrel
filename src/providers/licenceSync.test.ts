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

async function accountSetup(mode: 'no_licence' | 'grant' | 'limit' | 'down' | 'badsig' | 'authfail' | 'busy', beforeGrant?: () => Promise<void>, busyAnswers = 1) {
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
    if (url.endsWith('/v1/auth/firebase') && mode === 'busy' && busyAnswers-- > 0) return json(429, { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a minute and try again.' } });
    if (url.endsWith('/v1/auth/firebase')) return mode === 'authfail' ? json(401, { error: { code: 'AUTH_INVALID' } }) : json(200, { accessToken: 'session-token' });
    if (mode === 'no_licence') return json(403, { error: { code: 'NO_LICENCE', message: 'none' } });
    if (mode === 'limit') return json(409, { error: { code: 'DEVICE_LIMIT', message: 'full' } });
    if (beforeGrant) await beforeGrant();
    const payload = { schema: 1, grantId: 'grt_abcdefgh', plan: 'paid', managedAi: false, deviceHash, issuedAtMs: now, offlineUntilMs: now + 30 * 86_400_000 };
    const signature = mode === 'badsig' ? 'A'.repeat(86) + '==' : b64(await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(canonicalJson(payload))));
    return json(200, { grant: { payload, keyId: 'k1', signature }, activationId: 'act_1' });
  };
  const waits: number[] = [];
  const options = { baseUrl: 'https://licences.example.test', grantKeys, storage, fetch: fetchImpl as unknown as typeof fetch, now: () => now, platform: 'macos' as const, appVersion: '1.0.0', randomId: () => 'acct-device', sleep: async (ms: number) => { waits.push(ms); } };
  return { sync: new LicenceSync(options), reload: () => new LicenceSync(options), calls, waits, now, setMode: (next: typeof mode) => { mode = next; } };
}

test('signing in with no licence on the account stays Free', async () => {
  const env = await accountSetup('no_licence');
  const standing = await env.sync.activateAccount('firebase-id-token');
  assert.equal(standing?.kind, 'no_licence');
  assert.deepEqual(env.calls, ['/v1/auth/firebase', '/v1/me/activate Bearer session-token']);
  assert.equal(decideAccountAccess(standing!, env.now).pro, false);
  assert.equal(await env.reload().storedAccountStanding(), null);
  assert.equal(env.reload().hasStoredAccountGrant(), false, 'nothing kept, so the splash knows at once it is Free');
});

test('an account with a paid licence gets a verified grant that survives a restart and ends when forgotten', async () => {
  const env = await accountSetup('grant');
  const standing = await env.sync.activateAccount('firebase-id-token');
  assert.equal(standing?.kind, 'active');
  assert.deepEqual(decideAccountAccess(standing!, env.now), { pro: true, managedAi: false, basis: 'grant' });
  assert.equal((await env.reload().storedAccountStanding())?.kind, 'active');
  assert.equal(env.reload().hasStoredAccountGrant(), true, 'a kept grant makes the splash wait for it to be read');
  assert.equal(decideAccountAccess(standing!, env.now + 31 * 86_400_000).pro, false, 'the offline window ends');
  env.sync.forgetAccount();
  assert.equal(await env.reload().storedAccountStanding(), null);
  assert.equal(env.reload().hasStoredAccountGrant(), false);
});

test('sign-out during an online grant check cannot restore the signed-out account', async () => {
  let markReady!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const env = await accountSetup('grant', async () => {
    markReady();
    await finished;
  });
  const check = env.sync.activateAccount('firebase-id-token');
  await ready;
  env.sync.forgetAccount();
  finish();
  assert.equal(await check, null);
  assert.equal(await env.reload().storedAccountStanding(), null);
});

test('a "too many attempts" answer at sign-in is waited out, so Pro still arrives (26 Nov beta: Pro lost after sign-in)', async () => {
  const env = await accountSetup('busy');
  const standing = await env.sync.activateAccount('firebase-id-token');
  assert.equal(standing?.kind, 'active');
  assert.equal(env.waits.length, 1, 'waited once for the server\'s minute to pass');
  assert.deepEqual(env.calls, ['/v1/auth/firebase', '/v1/auth/firebase', '/v1/me/activate Bearer session-token']);
});

test('a server that keeps saying "too many attempts" is given up on after about a minute, never Pro by default', async () => {
  const env = await accountSetup('busy', undefined, 99);
  assert.equal(await env.sync.activateAccount('firebase-id-token'), null);
  const waited = env.waits.reduce((a, b) => a + b, 0);
  assert.ok(env.waits.length >= 2 && waited >= 60_000 && waited <= 90_000, `waited ${waited} ms over ${env.waits.length} tries`);
});

test('signing out while waiting out "too many attempts" ends the check', async () => {
  const env = await accountSetup('busy', undefined, 99);
  const check = env.sync.activateAccount('firebase-id-token');
  env.sync.forgetAccount();
  assert.equal(await check, null);
  assert.ok(env.calls.length <= 1, 'no further sign-in after sign-out');
});

test('a device limit, an unreachable server or a forged grant never unlocks Pro', async () => {
  assert.equal((await (await accountSetup('limit')).sync.activateAccount('t'))?.kind, 'device_limit');
  assert.equal(await (await accountSetup('down')).sync.activateAccount('t'), null);
  const forged = await accountSetup('badsig');
  assert.equal(await forged.sync.activateAccount('t'), null);
  assert.equal(await forged.reload().storedAccountStanding(), null);
});

test('the account session is kept in memory for cloud processing, is not stored, and ends on sign-out', async () => {
  const env = await accountSetup('grant');
  assert.equal(env.sync.accountConnection(), null, 'nothing before signing in');
  await env.sync.activateAccount('firebase-id-token');
  assert.equal(env.sync.accountConnection()?.session, 'session-token');
  assert.equal(env.reload().accountConnection(), null, 'a restarted app has no session until it signs in again');
  env.sync.forgetAccount();
  assert.equal(env.sync.accountConnection(), null);
});

test('a failed fresh identity exchange cannot retain a previous account session', async () => {
  const env = await accountSetup('grant');
  await env.sync.activateAccount('first-identity');
  assert.equal(env.sync.accountConnection()?.session, 'session-token');
  env.setMode('authfail');
  const pending = env.sync.activateAccount('second-identity');
  assert.equal(env.sync.accountConnection(), null, 'old bearer is not exposed during the new exchange');
  assert.equal(await pending, null);
  assert.equal(env.sync.accountConnection(), null, 'a rejected exchange cannot restore the old bearer');
  // An existing offline signed grant is not silently deleted on network/auth failure.
  assert.equal((await env.reload().storedAccountStanding())?.kind, 'active');
});


test('account device management exchanges fresh identity without activating or persisting a grant', async () => {
  const values = new Map<string, string>();
  const requests: Array<{ url: string; body: any; auth?: string }> = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  let failed = false;
  const sync = new LicenceSync({
    baseUrl: 'https://licences.example.test', grantKeys: { k1: 'unused-in-device-management' },
    storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } },
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization });
      if (url.endsWith('/v1/auth/firebase')) return json({ accessToken: 'fresh-session' });
      if (url.endsWith('/v1/me/devices/deactivate')) return failed ? json({}, 404) : json({ deactivated: true });
      return json({ status: 'active', validUntilMs: null, maxDevices: 5, devices: [{ activationId: 'act_other', platform: 'windows', appVersion: '1.0.0', lastSeenMs: 123, thisDevice: false }] });
    }) as unknown as typeof fetch,
    now: () => 123, platform: 'macos', appVersion: '1.0.0', randomId: () => 'account-device',
  });
  const status = await sync.accountDevices('fresh-identity');
  assert.equal(status?.maxDevices, 5);
  assert.equal(status?.devices[0]?.activationId, 'act_other');
  assert.equal(await sync.releaseAccountDevice('fresh-identity', 'act_other'), true);
  assert.equal(requests[1].auth, 'Bearer fresh-session');
  assert.deepEqual(Object.keys(requests[1].body), ['deviceHash']);
  assert.equal(requests[3].body.activationId, 'act_other');
  assert.ok(requests.every(r => !r.url.endsWith('/activate')));
  assert.equal(sync.accountConnection(), null);
  assert.equal(await sync.storedAccountStanding(), null);
  failed = true;
  assert.equal(await sync.releaseAccountDevice('fresh-identity', 'act_other'), false);
});

// ---- Buying Pro: the server opens a Paddle transaction and verifies it; the app opens our checkout page and waits for "paid".
function checkoutSetup(answers: Array<[number, unknown]>, configured = true) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let session = 0;
  const fetchImpl = async (url: string, init: RequestInit) => {
    const path = url.replace('https://licences.example.test', '');
    calls.push(`${init.method} ${path} ${(init.headers as Record<string, string>).authorization ?? ''}`.trim());
    if (init.body) bodies.push(JSON.parse(String(init.body)));
    if (path === '/v1/auth/firebase') return json(200, { accessToken: `s${++session}` });
    const next = answers.shift();
    if (!next) throw new Error('offline');
    return json(next[0], next[1]);
  };
  const values = new Map<string, string>();
  const storage: KeyValueStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } };
  const sync = new LicenceSync({ baseUrl: configured ? 'https://licences.example.test' : null, grantKeys: configured ? { k1: 'fRgITdAJPfCXpyEJ7DZml8316QBUgNlPsc3TPw07ZUw=' } : {}, storage,
    fetch: fetchImpl as unknown as typeof fetch, now: () => 0, platform: 'macos', appVersion: '1.0.0', randomId: () => 'd' });
  return { sync, calls, bodies };
}

test('buying Pro sends nothing but a fresh session, and returns our checkout page for the Paddle transaction', async () => {
  const env = checkoutSetup([[201, { checkoutId: 'txn_01testcheckout01', url: 'https://kestrel-hosting-kestrel.web.app/pro-checkout?_ptxn=txn_01testcheckout01' }]]);
  const started = await env.sync.startProCheckout('id-token');
  assert.deepEqual(started, { ok: true, checkoutId: 'txn_01testcheckout01', url: 'https://kestrel-hosting-kestrel.web.app/pro-checkout?_ptxn=txn_01testcheckout01', totalPence: null, currency: null });
  assert.deepEqual(env.calls, ['POST /v1/auth/firebase', 'POST /v1/me/checkout/pro Bearer s1']);
  assert.deepEqual(env.bodies[1], {});
});

test('the three checkout refusals come back calmly, and a build without the server never calls out', async () => {
  for (const code of ['CHECKOUT_DISABLED', 'ACCOUNT_UNVERIFIED', 'ALREADY_PRO']) {
    const env = checkoutSetup([[code === 'CHECKOUT_DISABLED' ? 503 : 409, { error: { code, message: 'x' } }]]);
    const started = await env.sync.startProCheckout('id-token');
    assert.equal(started.ok, false);
    assert.equal(!started.ok && started.code, code);
  }
  const offline = checkoutSetup([], false);
  assert.equal((await offline.sync.startProCheckout('id-token') as { code: string }).code, 'NOT_SET_UP');
  assert.deepEqual(offline.calls, []);
  assert.equal((await checkoutSetup([]).sync.startProCheckout('id-token') as { code: string }).code, 'UNREACHABLE');
});

test('checking a checkout reuses the session, renews it once when it expired, and is only paid when the server says so', async () => {
  const env = checkoutSetup([[201, { checkoutId: 'txn_01testcheckout01', url: 'https://kestrel-hosting-kestrel.web.app/pro-checkout?_ptxn=txn_01testcheckout01' }], [200, { status: 'pending' }], [401, {}], [200, { status: 'paid' }]]);
  await env.sync.startProCheckout('id-token');
  assert.equal(await env.sync.proCheckoutStatus('id-token', 'txn_01testcheckout01'), 'pending');
  assert.equal(await env.sync.proCheckoutStatus('id-token', 'txn_01testcheckout01'), 'paid');
  assert.deepEqual(env.calls.slice(2), ['GET /v1/me/checkout/pro/txn_01testcheckout01 Bearer s1', 'GET /v1/me/checkout/pro/txn_01testcheckout01 Bearer s1', 'POST /v1/auth/firebase', 'GET /v1/me/checkout/pro/txn_01testcheckout01 Bearer s2']);
  assert.equal(await env.sync.proCheckoutStatus('id-token', 'txn_01testcheckout01'), 'retry');
  assert.equal(await env.sync.proCheckoutStatus('id-token', '../admin'), 'gone');
});

test('attaching the device key to the account: once, never from another account, and nothing without a session', async () => {
  const requests: Array<{ url: string; body: any; auth?: string }> = [];
  let answer: [number, unknown] = [200, { attached: true, already: false }];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const make = (signIn = true) => new LicenceSync({
    baseUrl: 'https://licences.example.test', grantKeys: { k1: 'unused' },
    storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization });
      if (url.endsWith('/v1/auth/firebase')) return signIn ? json({ accessToken: 'fresh-session' }) : json({}, 401);
      return json(answer[1], answer[0]);
    }) as unknown as typeof fetch,
    now: () => 1, platform: 'windows', appVersion: '1.0.0', randomId: () => 'device',
  });
  const sync = make();
  assert.equal(await sync.attachKey('id-token', ' KESTREL1.abc.def '), 'attached');
  assert.deepEqual(requests[1], { url: 'https://licences.example.test/v1/me/licence/attach', body: { licenceKey: 'KESTREL1.abc.def' }, auth: 'Bearer fresh-session' });
  answer = [200, { attached: false, already: true }];
  assert.equal(await sync.attachKey('id-token', 'KESTREL1.abc.def'), 'already');
  answer = [409, { error: { code: 'LICENCE_ON_OTHER_ACCOUNT' } }];
  assert.equal(await sync.attachKey('id-token', 'KESTREL1.abc.def'), 'other');
  answer = [400, { error: { code: 'LICENCE_INVALID' } }];
  assert.equal(await sync.attachKey('id-token', 'KESTREL1.abc.def'), 'invalid');
  const count = requests.length;
  assert.equal(await make(false).attachKey('id-token', 'KESTREL1.abc.def'), 'unreachable');
  assert.equal(requests.length, count + 1, 'no attach request without a session');
  assert.equal(await sync.attachKey('id-token', '  '), 'unreachable');
});

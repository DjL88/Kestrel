import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAccountAiConsent, readAccountOnlineSettings, setAccountAiConsent } from './accountAiConsent';

type Call = { path: string; method: string; body: Record<string, unknown> | null; auth: string | null; options: RequestInit };
function makeServer(consent: boolean, enabledPlan = true, cloudPlan = false, quota: unknown = null) {
  const calls: Call[] = [];
  let live = consent;
  const fetcher = (async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    const headers = new Headers(options.headers);
    const body = typeof options.body === 'string' ? JSON.parse(options.body) as Record<string, unknown> : null;
    calls.push({ path, method: options.method ?? 'GET', body, auth: headers.get('authorization'), options });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'content-type': 'application/json' },
    });
    if (path === '/v1/auth/firebase')
      return body?.credential === 'firebase-id' ? json({ accessToken: 'short-lived-session' }) : json({ error: 'AUTH_INVALID' }, 401);
    if (headers.get('authorization') !== 'Bearer short-lived-session')
      return json({ error: 'AUTH_INVALID' }, 401);
    if (path === '/v1/me/entitlements')
      return json({ aiConsent: live, plans: enabledPlan ? [{ status: 'active', managedAi: true, plan: cloudPlan ? 'subscriber' : 'paid' }] : [] });
    if (path === '/v1/safe-copy/usage') return quota ? json(quota) : json({ error: 'SAFE_COPY_NOT_CONFIGURED' }, 503);
    if (path === '/v1/me/ai-consent') {
      if (typeof body?.consent !== 'boolean') return json({ error: 'INVALID_BODY' }, 400);
      live = body.consent;
      return json({ aiConsent: live });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }) as typeof fetch;
  return { calls, fetcher, current: () => live };
}

test('online AI setting reads live default-off consent; no photos, cookies or stored sessions', async () => {
  const mock = makeServer(false);
  const value = await readAccountAiConsent('https://control.example', 'firebase-id', mock.fetcher);
  assert.deepEqual(value, { consent: false, planAvailable: true });
  assert.deepEqual(mock.calls.map(c => [c.path, c.method]), [
    ['/v1/auth/firebase', 'POST'], ['/v1/me/entitlements', 'GET'],
  ]);
  assert.deepEqual(mock.calls[0].body, { credential: 'firebase-id' });
  assert.equal(mock.calls[1].auth, 'Bearer short-lived-session');
  for (const call of mock.calls) {
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.referrerPolicy, 'no-referrer');
    assert.equal(call.options.cache, 'no-store');
    assert.ok(!JSON.stringify(call.body).includes('image'));
  }
});

test('storage usage uses the signed-in cloud account and only displays a confirmed quota', async () => {
  const basic = makeServer(false);
  assert.equal((await readAccountOnlineSettings('https://control.example', 'firebase-id', basic.fetcher)).cloud, null);
  assert.equal(basic.calls.some(call => call.path === '/v1/safe-copy/usage'), false);

  const local = makeServer(false, true, true, { bytesUsed: 5_000_000_000, bytesQuota: 5_000_000_000 });
  const result = await readAccountOnlineSettings('https://control.example', 'firebase-id', local.fetcher);
  assert.deepEqual(result.cloud, { state: 'available', bytesUsed: 5_000_000_000, bytesQuota: 5_000_000_000 });
  assert.equal(local.calls.at(-1)?.auth, 'Bearer short-lived-session');

  const unavailable = makeServer(false, true, true);
  assert.deepEqual((await readAccountOnlineSettings('https://control.example', 'firebase-id', unavailable.fetcher)).cloud, { state: 'unavailable' });
  const malformed = makeServer(false, true, true, { bytesUsed: -1, bytesQuota: '0' });
  assert.deepEqual((await readAccountOnlineSettings('https://control.example', 'firebase-id', malformed.fetcher)).cloud, { state: 'unavailable' });
});

test('explicit opt-in and live revocation use the control plane, not local flags', async () => {
  const mock = makeServer(false);
  assert.equal(await setAccountAiConsent('https://control.example', 'firebase-id', true, mock.fetcher), true);
  assert.equal(mock.current(), true);
  assert.deepEqual(await readAccountAiConsent('https://control.example', 'firebase-id', mock.fetcher),
    { consent: true, planAvailable: true });
  assert.equal(await setAccountAiConsent('https://control.example', 'firebase-id', false, mock.fetcher), false);
  assert.equal(mock.current(), false);
  const writes = mock.calls.filter(c => c.path === '/v1/me/ai-consent');
  assert.deepEqual(writes.map(c => c.body), [{ consent: true }, { consent: false }]);
  assert.ok(writes.every(c => c.auth === 'Bearer short-lived-session'));
});

test('no eligible plan is explained independently of the default-off privacy preference', async () => {
  const mock = makeServer(false, false);
  assert.deepEqual(await readAccountAiConsent('https://control.example', 'firebase-id', mock.fetcher),
    { consent: false, planAvailable: false });
});

test('never contacts arbitrary HTTP sites or authenticates without Firebase login', async () => {
  const mock = makeServer(false);
  await assert.rejects(readAccountAiConsent('http://remote.example', 'firebase-id', mock.fetcher), /not configured/);
  await assert.rejects(readAccountAiConsent('https://control.example', null, mock.fetcher), /Sign in again/);
  await assert.rejects(setAccountAiConsent('https://control.example', null, true, mock.fetcher), /Sign in again/);
  assert.equal(mock.calls.length, 0);
});

test('invalid server answers and mismatched acknowledgement never masquerade as consent success', async () => {
  const server = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/v1/auth/firebase') return new Response(JSON.stringify({ accessToken: 'token' }), { status: 200 });
    if (path === '/v1/me/entitlements') return new Response(JSON.stringify({ aiConsent: 'true', plans: [] }), { status: 200 });
    if (path === '/v1/me/ai-consent') return new Response(JSON.stringify({ aiConsent: true }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  await assert.rejects(readAccountAiConsent('https://control.example', 'firebase-id', server), /Could not reach/);
  await assert.rejects(setAccountAiConsent('https://control.example', 'firebase-id', false, server), /Could not reach/);
});

test('network failures fail closed with an unknown state, never optimistically on/off', async () => {
  const broken = (async () => { throw new Error('Offline'); }) as typeof fetch;
  await assert.rejects(readAccountAiConsent('https://control.example', 'firebase-id', broken), /Could not reach/);
  await assert.rejects(setAccountAiConsent('https://control.example', 'firebase-id', false, broken), /Could not reach/);
});

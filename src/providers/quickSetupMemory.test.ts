import assert from 'node:assert/strict';
import test from 'node:test';
import { readSetup, restartSetup, saveSetupToAccount, syncSetupWithAccount, writeSetup } from './quickSetupMemory';

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}

function server(stored: unknown) {
  const calls: { path: string; method: string; body: unknown; auth: string | null }[] = [];
  let saved = stored;
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method: String(init.method), body, auth: new Headers(init.headers).get('authorization') });
    if (path === '/v1/auth/firebase') return new Response(JSON.stringify({ accessToken: 'session' }), { status: 200 });
    if (path === '/v1/me/preferences' && init.method === 'GET') return new Response(JSON.stringify({ preferences: saved ? { setup: saved } : {} }), { status: 200 });
    if (path === '/v1/me/preferences') { saved = body.setup; return new Response(JSON.stringify({ preferences: { setup: saved } }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetcher, calls, saved: () => saved };
}

const deps = (fetcher: typeof fetch) => ({ baseUrl: 'https://control.example.com', idToken: async () => 'firebase-id', fetcher });

test('answers are kept on this device and Run again starts from the first step, keeping them', () => {
  const store = memory();
  assert.equal(readSetup(store), null);
  writeSetup({ status: 'done', flightMode: 'solo' }, store);
  assert.equal(readSetup(store)?.status, 'done');
  restartSetup(store);
  assert.deepEqual(readSetup(store), { status: 'in-progress', step: 'language', flightMode: 'solo' });
});

test('signing in applies the account\'s finished answers here, so setup is not asked again', async () => {
  const store = memory();
  const s = server({ status: 'done', language: 'de', flightMode: 'autopilot', updatedAt: '2026-11-20T00:00:00Z' });
  const applied = await syncSetupWithAccount(deps(s.fetcher), store);
  assert.equal(applied?.flightMode, 'autopilot');
  assert.equal(readSetup(store)?.status, 'done');
  assert.equal(s.calls.find((c) => c.path === '/v1/me/preferences')?.auth, 'Bearer session');
});

test('this device\'s finished answers are saved to an account that has none, without the step', async () => {
  const store = memory();
  writeSetup({ status: 'done', experience: 'pro', step: 'extras', updatedAt: '2026-11-20T00:00:00Z' }, store);
  const s = server(null);
  assert.equal(await syncSetupWithAccount(deps(s.fetcher), store), null);
  assert.deepEqual(s.saved(), { status: 'done', experience: 'pro', updatedAt: '2026-11-20T00:00:00Z' });
});

test('signed out or offline, nothing breaks and this device keeps its answers', async () => {
  const store = memory();
  writeSetup({ status: 'skipped' }, store);
  assert.equal(await syncSetupWithAccount({ baseUrl: 'https://control.example.com', idToken: async () => null }, store), undefined);
  const offline = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
  assert.equal(await syncSetupWithAccount(deps(offline), store), undefined);
  assert.equal(await saveSetupToAccount({ status: 'done' }, deps(offline)), false);
  assert.equal(readSetup(store)?.status, 'skipped');
});

test('a new account, or one with nothing saved, is reported as checked and empty, so setup runs after sign-up', async () => {
  const s = server(null);
  assert.equal(await syncSetupWithAccount(deps(s.fetcher), memory()), null);
});

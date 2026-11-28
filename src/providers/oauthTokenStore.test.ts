import assert from 'node:assert/strict';
import test from 'node:test';
import { createOAuthTokenStore } from './oauthTokenStore';
import type { Tokens } from '../core/cloudDrive';

function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  return { values, storage, store: createOAuthTokenStore(storage) };
}
const old: Tokens = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 1_000 };
const fresh: Tokens = { accessToken: 'fresh-access', refreshToken: 'rotated-refresh', expiresAt: 3_600_000 };
function deferred() {
  let resolve!: (value: Tokens) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Tokens>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test('concurrent access requests share one refresh and persist the rotated token', async () => {
  const { store, storage } = setup();
  store.remember('drive', old);
  let calls = 0;
  const gate = deferred();
  const refresh = async (owner: Tokens) => { calls++; assert.equal(owner.refreshToken, old.refreshToken); return gate.promise; };
  const a = store.access('drive', 2_000, refresh);
  const b = store.access('drive', 2_000, refresh);
  await Promise.resolve();
  assert.equal(calls, 1);
  gate.resolve(fresh);
  assert.deepEqual(await Promise.all([a, b]), ['fresh-access', 'fresh-access']);
  const reopened = createOAuthTokenStore(storage);
  assert.equal(await reopened.access('drive', 3_000, async () => { throw Error('unexpected refresh'); }), 'fresh-access');
});

test('disconnect while refresh is in flight cannot restore a token in memory or storage', async () => {
  const { store, values } = setup();
  store.remember('drive', old);
  const gate = deferred();
  const request = store.access('drive', 2_000, () => gate.promise);
  await Promise.resolve();
  store.forget('drive');
  gate.resolve(fresh);
  await assert.rejects(request, /connection changed/);
  assert.equal(store.has('drive'), false);
  assert.equal(values.size, 0);
});

test('reconnect while an earlier refresh runs preserves the new login', async () => {
  const { store } = setup();
  store.remember('drive', old);
  const gate = deferred();
  const request = store.access('drive', 2_000, () => gate.promise);
  await Promise.resolve();
  store.remember('drive', { ...fresh, accessToken: 'new-login' });
  gate.resolve(fresh);
  await assert.rejects(request, /connection changed/);
  assert.equal(await store.access('drive', 3_000, async () => { throw Error('unexpected refresh'); }), 'new-login');
});

test('failed refresh does not permanently poison later requests or other connections', async () => {
  const { store } = setup();
  store.remember('a', old);
  store.remember('b', old);
  await assert.rejects(store.access('a', 2_000, async () => { throw Error('offline'); }), /offline/);
  assert.equal(await store.access('b', 2_000, async () => fresh), 'fresh-access');
  assert.equal(await store.access('a', 2_000, async () => fresh), 'fresh-access');
});

test('invalid persisted credentials are not treated as a sign-in', () => {
  const { store, values } = setup();
  for (const invalid of [{ accessToken: 'bad' }, { ...old, expiresAt: 'never' }, { ...old, refreshToken: 42 }]) {
    values.set('kestrel.cloud-tokens.v1.drive', JSON.stringify(invalid));
    assert.equal(store.has('drive'), false);
  }
});

test('a failed storage removal cannot resurrect the disconnected login in this session', async () => {
  const { storage } = setup();
  const store = createOAuthTokenStore({ ...storage, removeItem() { throw Error('storage unavailable'); } });
  store.remember('drive', old);
  store.forget('drive');
  assert.equal(store.has('drive'), false);
  await assert.rejects(store.access('drive', 2_000, async () => fresh), /Sign in again/);
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { canonicalJson } from '../core/signedEnvelope.ts';
import { PublicFlags, PUBLIC_FLAGS_KEY, PUBLIC_FLAGS_REFRESH_MS } from './publicFlags.ts';

const pair = crypto.generateKeyPairSync('ed25519');
const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('base64');
const keys = { 'kcp-test': publicKey };
const envelope = (payload: unknown, key = pair.privateKey) => ({ payload, keyId: 'kcp-test', signature: crypto.sign(null, Buffer.from(canonicalJson(payload)), key).toString('base64') });
const doc = (flags: unknown) => envelope({ schema: 1, flags });
const GOOD = { smartCulling: { default: false, rules: [{ audience: { kind: 'plan', plan: 'unknown' }, enabled: true, trial: true }] } };

function setup(reply: () => Response | Promise<Response>, over: { baseUrl?: string | null; keys?: Record<string, string>; online?: boolean } = {}) {
  const values = new Map<string, string>();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const clock = { now: Date.UTC(2026, 10, 22) };
  const make = () => new PublicFlags({
    baseUrl: over.baseUrl === undefined ? 'https://flags.example.test' : over.baseUrl, keys: over.keys ?? keys,
    storage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } },
    fetch: (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return reply(); }) as unknown as typeof fetch,
    now: () => clock.now, online: () => over.online ?? true,
  });
  return { flags: make(), reload: make, values, calls, clock };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a build with no control plane address or no pinned key makes no request at all', async () => {
  for (const over of [{ baseUrl: null }, { keys: {} }]) {
    const env = setup(() => json(doc(GOOD)), over);
    assert.equal(await env.flags.refreshIfDue(), null);
    assert.equal(await env.flags.stored(), null);
    assert.equal(env.calls.length, 0);
  }
});

test('it fetches a signed document, keeps it, and sends nothing about the person', async () => {
  const env = setup(() => json(doc(GOOD)));
  const flags = await env.flags.refreshIfDue();
  assert.equal(flags?.smartCulling.rules.length, 1);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].url, 'https://flags.example.test/v1/flags/public');
  assert.equal(env.calls[0].init?.credentials, 'omit');
  assert.equal(env.calls[0].init?.referrerPolicy, 'no-referrer');
  assert.equal(env.calls[0].init?.body, undefined);
  assert.equal((await env.reload().stored())?.smartCulling.default, false);
});

test('it asks at most once a day, then again when the kept copy is a day old', async () => {
  const env = setup(() => json(doc(GOOD)));
  await env.flags.refreshIfDue();
  await env.flags.refreshIfDue();
  assert.equal(env.calls.length, 1);
  env.clock.now += PUBLIC_FLAGS_REFRESH_MS;
  await env.flags.refreshIfDue();
  assert.equal(env.calls.length, 2);
});

test('a document signed with the wrong key, or changed after signing, is ignored and the kept copy stays', async () => {
  const other = crypto.generateKeyPairSync('ed25519');
  const env = setup(() => json(envelope({ schema: 1, flags: GOOD }, other.privateKey)));
  assert.equal(await env.flags.refreshIfDue(), null, 'nothing kept and the forged copy is refused');
  const good = setup(() => json(doc(GOOD)));
  await good.flags.refreshIfDue();
  const stored = JSON.parse(good.values.get(PUBLIC_FLAGS_KEY)!);
  stored.envelope.payload.flags.smartCulling.default = true;
  good.values.set(PUBLIC_FLAGS_KEY, JSON.stringify(stored));
  assert.equal(await good.reload().stored(), null, 'a tampered stored copy is not used');
});

test('network failure, a server error, or being offline keeps the last verified copy', async () => {
  const env = setup(() => json(doc(GOOD)));
  await env.flags.refreshIfDue();
  env.clock.now += 2 * PUBLIC_FLAGS_REFRESH_MS;
  const failing = new PublicFlags({
    baseUrl: 'https://flags.example.test', keys,
    storage: { getItem: (k) => env.values.get(k) ?? null, setItem: (k, v) => { env.values.set(k, v); } },
    fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch, now: () => env.clock.now,
  });
  assert.equal((await failing.refreshIfDue())?.smartCulling.rules.length, 1);
  const broken = setup(() => json({ error: 'x' }, 500));
  assert.equal(await broken.flags.refreshIfDue(), null);
  const offline = setup(() => json(doc(GOOD)), { online: false });
  assert.equal(await offline.flags.refreshIfDue(), null);
  assert.equal(offline.calls.length, 0);
});

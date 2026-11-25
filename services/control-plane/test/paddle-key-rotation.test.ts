import assert from 'node:assert/strict';
import test from 'node:test';
import { paddleKeyId, rotatePaddleKeyIfDue, rotatingKeySource, secretManagerSecret, type RotationState } from '../src/commerce/paddleKeyRotation.ts';

const ID = 'a'.repeat(26);
const KEY_1 = `pdl_live_apikey_${ID}_firstSecret1`;
const KEY_2 = `pdl_live_apikey_${ID}_secondSecret2`;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 25, 9);

test('the key ID comes from the key itself; anything else is refused', () => {
  assert.equal(paddleKeyId(KEY_1), 'apikey_' + ID);
  assert.equal(paddleKeyId(`pdl_sdbx_apikey_${ID}_x`), 'apikey_' + ID);
  for (const bad of ['', 'pdl_live_apikey_short_x', `pdl_live_ntfset_${ID}_x`, 'live_clienttoken']) assert.throws(() => paddleKeyId(bad));
});

/** Fake Paddle rotation endpoints and a fake secret; the test decides what Paddle answers. */
function world(options: { refuse?: number; wrongKey?: boolean; addFails?: boolean } = {}) {
  const versions = [KEY_1];
  const calls: { url: string; auth: string; body?: any }[] = [];
  let state: RotationState | null = null;
  const request = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    calls.push({ url: u, auth, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    assert.ok(u.startsWith('https://api.paddle.com/api-keys/apikey_' + ID + '/rotations'), u);
    if (init?.method === 'POST') {
      if (options.refuse) return new Response('{}', { status: options.refuse });
      return Response.json({ data: { id: 'apkrot_' + 'b'.repeat(26), api_key_id: 'apikey_' + (options.wrongKey ? 'c'.repeat(26) : ID), new_key: KEY_2, status: 'pending' } });
    }
    return auth === 'Bearer ' + KEY_2 ? Response.json({ data: { status: 'completed' } }) : new Response('{}', { status: 401 });
  }) as typeof fetch;
  return {
    versions, calls, request,
    secret: { latest: async () => versions.at(-1)!, add: async (v: string) => { if (options.addFails) throw new Error('Secret Manager down'); versions.push(v); } },
    store: { get: async () => state, set: async (s: RotationState) => { state = s; } },
    state: () => state,
  };
}

test('first run renews the key: new secret saved, then activated with one call, with a fresh 90-day expiry', async () => {
  const w = world();
  const result = await rotatePaddleKeyIfDue({ secret: w.secret, store: w.store, request: w.request, now: () => T0 });
  assert.deepEqual(result, { rotated: true, expiresAt: new Date(T0 + 90 * DAY).toISOString(), activated: true });
  assert.deepEqual(w.versions, [KEY_1, KEY_2]);
  assert.equal(w.calls[0].auth, 'Bearer ' + KEY_1, 'the key rotates itself');
  assert.deepEqual(w.calls[0].body, { grace_period_seconds: 3600, new_key_expires_at: new Date(T0 + 90 * DAY).toISOString() });
  assert.equal(w.calls[1].auth, 'Bearer ' + KEY_2, 'activation uses the new secret');
  assert.equal(w.state()?.rotatedAt, new Date(T0).toISOString());
});

test('nothing happens until 60 days after the last renewal, then it renews again', async () => {
  const w = world();
  await rotatePaddleKeyIfDue({ secret: w.secret, store: w.store, request: w.request, now: () => T0 });
  w.calls.length = 0;
  const early = await rotatePaddleKeyIfDue({ secret: w.secret, store: w.store, request: w.request, now: () => T0 + 59 * DAY });
  assert.deepEqual(early, { rotated: false, nextDueAt: new Date(T0 + 60 * DAY).toISOString() });
  assert.equal(w.calls.length, 0);
  // Same key ID after rotation, so the record still matches; at 60 days it renews.
  const due = await rotatePaddleKeyIfDue({ secret: w.secret, store: w.store, request: w.request, now: () => T0 + 60 * DAY });
  assert.equal(due.rotated, true);
});

test('a key that is not rotatable fails loudly and changes nothing', async () => {
  const w = world({ refuse: 403 });
  await assert.rejects(rotatePaddleKeyIfDue({ secret: w.secret, store: w.store, request: w.request, now: () => T0 }), /Rotatable/);
  assert.deepEqual(w.versions, [KEY_1]);
  assert.equal(w.state(), null);
});

test('a rotation for another key, or a failed save, leaves the old key in place and unactivated', async () => {
  const wrong = world({ wrongKey: true });
  await assert.rejects(rotatePaddleKeyIfDue({ secret: wrong.secret, store: wrong.store, request: wrong.request, now: () => T0 }), /different key/);
  assert.deepEqual(wrong.versions, [KEY_1]);
  const down = world({ addFails: true });
  await assert.rejects(rotatePaddleKeyIfDue({ secret: down.secret, store: down.store, request: down.request, now: () => T0 }), /Secret Manager down/);
  assert.equal(down.calls.filter((c) => c.auth === 'Bearer ' + KEY_2).length, 0, 'never activated, so the old secret keeps working');
  assert.equal(down.state(), null);
});

test('the server re-reads the key every 5 minutes and keeps the last good key if Secret Manager is down', async () => {
  let clock = T0;
  let value = KEY_1;
  let up = true;
  let reads = 0;
  const key = rotatingKeySource(async () => { reads++; if (!up) throw new Error('down'); return value; }, undefined, 5 * 60_000, () => clock);
  assert.equal(await key(), KEY_1);
  value = KEY_2;
  clock += 4 * 60_000;
  assert.equal(await key(), KEY_1, 'cached');
  clock += 2 * 60_000;
  assert.equal(await key(), KEY_2, 'picked up the renewed key');
  up = false;
  clock += 6 * 60_000;
  assert.equal(await key(), KEY_2, 'outage: last good key');
  assert.equal(reads, 3);
  const cold = rotatingKeySource(async () => { throw new Error('down'); }, KEY_1, 5 * 60_000, () => clock);
  assert.equal(await cold(), KEY_1, 'falls back to the start-up value');
});

test('Secret Manager: reads the latest version and adds a new one, base64 both ways', async () => {
  const seen: { url: string; body?: any }[] = [];
  const request = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).endsWith('/versions/latest:access')) return Response.json({ payload: { data: Buffer.from(KEY_1 + '\n').toString('base64') } });
    return Response.json({ name: 'v2' });
  }) as typeof fetch;
  const s = secretManagerSecret({ project: 'kestrel-hosting', secret: 'kestrel-paddle-api-key', request, token: async () => 'tok' });
  assert.equal(await s.latest(), KEY_1);
  await s.add(KEY_2);
  assert.equal(seen[1].url, 'https://secretmanager.googleapis.com/v1/projects/kestrel-hosting/secrets/kestrel-paddle-api-key:addVersion');
  assert.equal(Buffer.from(seen[1].body.payload.data, 'base64').toString(), KEY_2);
  assert.throws(() => secretManagerSecret({ project: '../x', secret: 's' }));
});

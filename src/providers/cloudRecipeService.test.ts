import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUD_RECIPE_PREVIEW_KEY, cloudRecipePreviewOn, httpCloudRecipeService, readFullFileConsent, saveFullFileConsent } from './cloudRecipeService.ts';

const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } }; };

test('the full-file opt-in starts off, turns on and can be withdrawn', () => {
  const store = memory();
  assert.equal(readFullFileConsent(store).on, false);
  assert.equal(saveFullFileConsent(true, 1, store).on, true);
  assert.equal(saveFullFileConsent(false, 2, store).on, false);
  assert.equal(readFullFileConsent(null).on, false, 'no storage counts as off');
  assert.equal(saveFullFileConsent(true, 3, null).on, false, 'an opt-in that cannot be kept is not in force');
});

test('the device preview switch is off unless set', () => {
  const store = memory();
  assert.equal(cloudRecipePreviewOn(store), false);
  store.setItem(CLOUD_RECIPE_PREVIEW_KEY, '1');
  assert.equal(cloudRecipePreviewOn(store), true);
});

test('the HTTP service says which picture it sends, returns the job id, and always calls finish', async () => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const bucket = 'kestrel-jobs';
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/v1/cloud/jobs') && method === 'POST') return json({ jobId: 'abc-1', uploadUrl: `https://storage.googleapis.com/${bucket}/inputs/abc-1?sig=1` });
    if (url.includes('/inputs/abc-1')) return new Response(null, { status: 200 });
    if (url.endsWith('/abc-1/start')) return json({ ok: true });
    if (url.endsWith('/abc-1') && method === 'GET') return json({ jobId: 'abc-1', kind: 'recipe', status: 'ready', resultUrl: `https://storage.googleapis.com/${bucket}/results/abc-1?sig=2` });
    if (url.includes('/results/abc-1')) return new Response(JSON.stringify({ protocol: 1, jobId: 'abc-1', input: 'smart-preview', settings: { exposure: 0.4 } }));
    if (url.endsWith('/abc-1/finish')) return json({ ok: true });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const service = httpCloudRecipeService({ baseUrl: 'https://control.example.com', session: 'token', fetch: fakeFetch, pollIntervalMs: 1 });
  const answer = await service.run({ input: new Blob([new Uint8Array(10)]), inputKind: 'smart-preview', userConsent: true });
  assert.equal(answer.jobId, 'abc-1');
  assert.match(new TextDecoder().decode(answer.bytes), /"exposure":0.4/);
  assert.deepEqual(calls[0].body, { kind: 'recipe', inputBytes: 10, userConsent: true, inputKind: 'smart-preview' });
  assert.ok(calls.some((call) => call.url.endsWith('/abc-1/finish')), 'finish deletes the upload');
  await assert.rejects(service.run({ input: new Blob([new Uint8Array(1)]), inputKind: 'original', userConsent: false }), /approval/);
});

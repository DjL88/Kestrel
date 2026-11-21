import assert from 'node:assert/strict';
import test from 'node:test';
import { checkKey } from './onlineHelper';

const flash = { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] };

test('the AI key check follows bounded model pages when the first page lacks an eligible model', async () => {
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (seen.length === 1) return Response.json({ models: [{ name: 'models/embedding-model', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'page 2' });
    return Response.json({ models: [flash] });
  }) as typeof fetch;
  const result = await checkKey('my-key', fetcher);
  assert.equal(result.model, 'gemini-3.5-flash');
  assert.equal(seen.length, 2);
  assert.equal(new URL(seen[1]).searchParams.get('pageToken'), 'page 2');
});

test('API key checking does not loop on repeated continuation tokens', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json({ models: [], nextPageToken: 'repeat' }); }) as typeof fetch;
  await assert.rejects(checkKey('my-key', fetcher), /no supported Flash model/);
  assert.equal(calls, 2);
});

test('a cancelled key check does not request further pages', async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    controller.abort();
    return Response.json({ models: [], nextPageToken: 'other' });
  }) as typeof fetch;
  await assert.rejects(checkKey('my-key', fetcher, controller.signal), /cancelled|AbortError/);
  assert.equal(calls, 1);
});

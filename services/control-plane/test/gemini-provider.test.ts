import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiProvider } from '../src/gateway.ts';
import { fakeProvider, image, startHarness } from './helpers.ts';

const KEY = 'AIza-test-secret-key';

test('Gemini request: key only in the header, body is the prompt and the one image, nothing about the person', async () => {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"exposure":0.1}' }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = geminiProvider(KEY, 'gemini-2.5-flash', fetcher);
  await p.suggest('QUJD', new AbortController().signal);
  await p.verifyColour('QUJD', new AbortController().signal);
  assert.equal(seen.length, 2);
  for (const s of seen) {
    assert.equal(s.headers['x-goog-api-key'], KEY);
    assert.ok(!s.url.includes(KEY), 'key never in the URL');
    assert.ok(!s.body.includes(KEY));
    const parts = JSON.parse(s.body).contents[0].parts as { text?: string; inlineData?: { data: string } }[];
    assert.equal(parts.filter((x) => x.inlineData).length, 1, 'exactly one image');
    assert.ok(!/@|accountId|email|userConsent/i.test(s.body.replace(/"text":"[^"]*"/g, '')), 'no account fields in the request');
  }
});

test('an upstream failure never leaks the provider key or the image to the client', async () => {
  const provider = fakeProvider({ async identify() { throw new Error(`boom ${KEY} QUJDRA==`); } });
  const h = await startHarness(provider);
  try {
    await h.call('POST', '/v1/me/ai-consent', { token: h.user.token, body: { consent: true } });
    const img = image();
    const r = await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: img, userConsent: true } });
    assert.equal(r.status, 502);
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes(KEY) && !text.includes(img.slice(0, 40)));
    const q = await h.app.store.getQuota(h.user.accountId);
    assert.equal(q?.requestsUsed, 0, 'failed call refunded');
  } finally { await h.close(); }
});

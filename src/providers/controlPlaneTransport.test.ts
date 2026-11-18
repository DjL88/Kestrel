import test from 'node:test';
import assert from 'node:assert/strict';
import { HelperError } from '../core/onlineHelper';
import { controlPlaneTransport } from './controlPlaneTransport';

const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
const clean = Buffer.from([0xff, 0xd8, ...sof, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]).toString('base64');
const exif = [...Buffer.from('Exif\0\0MM')];
const tagged = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, exif.length + 2, ...exif, ...sof, 0xff, 0xda, 0x00, 0x02]).toString('base64');

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failureOf = async (promise: Promise<unknown>) => { try { await promise; return 'no failure'; } catch (e) { return (e as HelperError).failure; } };

test('sends a consented, metadata-free thumbnail with a bearer token and re-checks the answer', async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const transport = controlPlaneTransport('https://cp.example', () => 'token-1', async (url, init) => {
    sent = { url: String(url), init: init! };
    return new Response(JSON.stringify({ kind: 'wildlife', species: 'kingfisher', scientific: 'Alcedo atthis', confidence: 'high', tags: ['<script>', 'perched'], abstained: false }), { status: 200 });
  });
  const answer = await transport.ask(clean);
  assert.equal(sent!.url, 'https://cp.example/v1/ai/identify');
  assert.equal((sent!.init.headers as Record<string, string>).authorization, 'Bearer token-1');
  assert.equal(JSON.parse(String(sent!.init.body)).userConsent, true);
  assert.equal(answer.species, 'Kingfisher');
  assert.deepEqual(answer.tags, ['perched'], 'markup from the server is dropped too');
});

test('never sends without a session, over plain http, or with camera metadata inside', async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response('{}'); };
  assert.equal(await failureOf(controlPlaneTransport('https://cp.example', () => null, fetcher).ask(clean)), 'auth');
  assert.equal(await failureOf(controlPlaneTransport('https://cp.example', () => 't', fetcher).ask(tagged)), 'other');
  assert.throws(() => controlPlaneTransport('http://cp.example', () => 't', fetcher));
  assert.equal(called, false);
});

test('server refusals become the helper states the app already shows', async () => {
  const ask = (status: number, code = 'X') => failureOf(controlPlaneTransport('https://cp.example', () => 't', reply(status, { error: { code } })).ask(clean));
  assert.equal(await ask(401, 'AUTH_TOKEN_EXPIRED'), 'auth');
  assert.equal(await ask(403, 'AI_NOT_ENTITLED'), 'auth');
  assert.equal(await ask(429, 'AI_QUOTA_EXHAUSTED'), 'rate');
  assert.equal(await ask(504, 'AI_UPSTREAM_TIMEOUT'), 'timeout');
  assert.equal(await ask(503, 'AI_DISABLED'), 'other');
  assert.equal(await ask(200), 'other', 'a 200 that is not a helper answer is not used');
});

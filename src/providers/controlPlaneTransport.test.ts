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
  }, () => true);
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
  assert.equal(await failureOf(controlPlaneTransport('https://cp.example', () => 't', fetcher, () => true).ask(tagged)), 'other');
  assert.throws(() => controlPlaneTransport('http://cp.example', () => 't', fetcher));
  assert.equal(called, false);
});

test('server refusals become the helper states the app already shows', async () => {
  const ask = (status: number, code = 'X') => failureOf(controlPlaneTransport('https://cp.example', () => 't', reply(status, { error: { code } }), () => true).ask(clean));
  assert.equal(await ask(401, 'AUTH_TOKEN_EXPIRED'), 'auth');
  assert.equal(await ask(403, 'AI_NOT_ENTITLED'), 'auth');
  assert.equal(await ask(403, 'AI_CONSENT_REQUIRED'), 'auth', 'account-level consent rejection is explained');
  assert.equal(await ask(429, 'AI_QUOTA_EXHAUSTED'), 'rate');
  assert.equal(await ask(504, 'AI_UPSTREAM_TIMEOUT'), 'timeout');
  assert.equal(await ask(503, 'AI_DISABLED'), 'other');
  assert.equal(await ask(200), 'other', 'a 200 that is not a helper answer is not used');
});

test('suggest reaches the managed slider-suggestion route with the same auth and re-checks the proposal', async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const transport = controlPlaneTransport('https://cp.example', () => 'token-1', async (url, init) => {
    sent = { url: String(url), init: init! };
    return new Response(JSON.stringify({ proposal: { exposure: 0.3, invented: 9 }, alreadyBalanced: false }), { status: 200 });
  }, () => true);
  const proposal = await transport.suggest(clean);
  assert.equal(sent!.url, 'https://cp.example/v1/ai/suggest');
  assert.equal((sent!.init.headers as Record<string, string>).authorization, 'Bearer token-1');
  assert.deepEqual(proposal, { exposure: 0.3 }, 'an unknown slider from the server is dropped too');
});

test('verifyColour reaches the managed colour-grade route and keeps the answer bounded', async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const transport = controlPlaneTransport('https://cp.example', () => 'token-1', async (url, init) => {
    sent = { url: String(url), init: init! };
    return new Response(JSON.stringify({ plausible: false, concerns: ['skinTone', 'clipping', 'other'], note: 'Shadows lean green.' }), { status: 200 });
  }, () => true);
  const answer = await transport.verifyColour(clean);
  assert.equal(sent!.url, 'https://cp.example/v1/ai/verify-colour');
  assert.deepEqual(answer, { plausible: false, concerns: ['skinTone', 'clipping'], note: 'Shadows lean green.' }, 'capped at two concerns, as the server itself already enforces');
});

test('suggest and verifyColour fail closed the same way identify does: no session, bad answer, or a refusal', async () => {
  const fetcher = async () => { throw new Error('must not be called'); };
  assert.equal(await failureOf(controlPlaneTransport('https://cp.example', () => null, fetcher).suggest(clean)), 'auth');
  assert.equal(await failureOf(controlPlaneTransport('https://cp.example', () => null, fetcher).verifyColour(clean)), 'auth');
  assert.equal(await failureOf(controlPlaneTransport('https://cp.example', () => 't', reply(200, { proposal: 'not an object' }), () => true).suggest(clean)), 'other');
  assert.equal(await failureOf(controlPlaneTransport('https://cp.example', () => 't', reply(200, { plausible: 'not a boolean' }), () => true).verifyColour(clean)), 'other');
  assert.equal(await failureOf(controlPlaneTransport('https://cp.example', () => 't', reply(403, { error: { code: 'AI_NOT_ENTITLED' } }), () => true).suggest(clean)), 'auth');
});


test('no explicit action permission means zero photo uploads even with a signed-in account', async () => {
  let networkCalls = 0;
  const fake = async () => { networkCalls++; return new Response('{}'); };
  const transport = controlPlaneTransport('https://cp.example', () => 'valid-session', fake);
  assert.equal(await failureOf(transport.ask(clean)), 'blocked');
  assert.equal(await failureOf(transport.suggest(clean)), 'blocked');
  assert.equal(await failureOf(transport.verifyColour(clean)), 'blocked');
  assert.equal(networkCalls, 0);
});

test('one deliberate current-photo approval allows one identified route, then expires', async () => {
  const requests: string[] = [];
  let approvedRoute: string | null = null;
  const fake = async (url: RequestInfo | URL) => {
    requests.push(new URL(String(url)).pathname);
    return new Response(JSON.stringify({ kind: 'other', species: null, confidence: 'low', tags: [] }), { status: 200 });
  };
  const transport = controlPlaneTransport('https://cp.example', () => 'valid-session', fake,
    path => {
      const accepted = path === approvedRoute;
      approvedRoute = null; // the caller must deliberately authorise each photo request
      return accepted;
    });
  approvedRoute = '/v1/ai/identify';
  await transport.ask(clean);
  assert.equal(await failureOf(transport.ask(clean)), 'blocked');
  assert.equal(await failureOf(transport.suggest(clean)), 'blocked');
  assert.deepEqual(requests, ['/v1/ai/identify']);
});

test('a throwing permission callback also refuses before any image leaves this device', async () => {
  let called = false;
  const fake = async () => { called = true; return new Response('{}'); };
  const transport = controlPlaneTransport('https://cp.example', () => 'valid-session', fake, () => {
    throw new Error('photo changed');
  });
  assert.equal(await failureOf(transport.ask(clean)), 'blocked');
  assert.equal(called, false);
});

test('account-switch session is resolved per request and never reuses a prior bearer token', async () => {
  let token: string | null = 'account-a';
  const seen: string[] = [];
  const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>).authorization);
    return new Response(JSON.stringify({ kind: 'other', species: null, confidence: 'low', tags: [] }), { status: 200 });
  };
  let approved = false;
  const transport = controlPlaneTransport('https://cp.example', () => token, fetcher, () => {
    const once = approved;
    approved = false;
    return once;
  });
  approved = true;
  await transport.ask(clean);
  token = null;
  approved = true;
  assert.equal(await failureOf(transport.ask(clean)), 'auth', 'sign-out refuses before upload');
  token = 'account-b';
  assert.equal(await failureOf(transport.ask(clean)), 'blocked', 'account switch cannot reuse a previous approval');
  approved = true;
  await transport.ask(clean);
  assert.deepEqual(seen, ['Bearer account-a', 'Bearer account-b']);
});

test('permission for one route cannot silently authorise a different managed AI route', async () => {
  const seen: string[] = [];
  let approvedRoute: string | null = '/v1/ai/identify';
  const fetcher = async (url: RequestInfo | URL) => {
    seen.push(new URL(String(url)).pathname);
    return new Response(JSON.stringify({ kind: 'other', species: null, confidence: 'low', tags: [] }), { status: 200 });
  };
  const transport = controlPlaneTransport('https://cp.example', () => 'token', fetcher, route => {
    const ok = route === approvedRoute;
    approvedRoute = null;
    return ok;
  });
  assert.equal(await failureOf(transport.suggest(clean)), 'blocked');
  assert.equal(await failureOf(transport.verifyColour(clean)), 'blocked');
  assert.deepEqual(seen, []);
  approvedRoute = '/v1/ai/identify';
  await transport.ask(clean);
  assert.equal(await failureOf(transport.ask(clean)), 'blocked');
  assert.deepEqual(seen, ['/v1/ai/identify']);
});

test('a signed-out attempt consumes permission even before authentication, preventing cross-account reuse', async () => {
  let session: string | null = null;
  let ready = true;
  let permissionsChecked = 0;
  let sent = 0;
  const transport = controlPlaneTransport('https://cp.example', () => session, async () => {
    sent += 1;
    throw new Error('A blocked request must never send a thumbnail');
  }, () => {
    permissionsChecked++;
    const permission = ready;
    ready = false;
    return permission;
  });
  assert.equal(await failureOf(transport.ask(clean)), 'auth');
  assert.equal(permissionsChecked, 1, 'sign-out consumes a pending permission once');
  session = 'new-account';
  assert.equal(await failureOf(transport.ask(clean)), 'blocked');
  assert.equal(permissionsChecked, 2);
  assert.equal(sent, 0, 'neither the signed-out nor new-account request uploaded pixels');
});

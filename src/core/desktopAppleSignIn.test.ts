import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { appleFirebaseFailureMessage, appleAnswerFromQuery, appleSignInPageUrl, desktopAppleConfig, sha256Hex } from './desktopAppleSignIn.ts';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.c2ln`;
const expected = { state: 's1', servicesId: 'app.kestrel.photo.web', hashedNonce: 'abc123' };
const good = token({ iss: 'https://appleid.apple.com', aud: 'app.kestrel.photo.web', nonce: 'abc123', sub: 'u' });

test('the desktop app offers Apple only with an HTTPS website address, and uses the registered Services ID by default', () => {
  assert.deepEqual(desktopAppleConfig({ VITE_KESTREL_SITE_URL: 'https://kestrel-hosting-kestrel.web.app/' }),
    { servicesId: 'app.kestrel.photo.web', pageUrl: 'https://kestrel-hosting-kestrel.web.app/apple-signin' });
  assert.equal(desktopAppleConfig({ VITE_KESTREL_SITE_URL: 'https://inflight.studio', VITE_APPLE_SERVICES_ID: 'other.id' })!.servicesId, 'other.id');
  assert.equal(desktopAppleConfig({}), null);
  assert.equal(desktopAppleConfig({ VITE_KESTREL_SITE_URL: 'http://localhost:3000' }), null);
  assert.equal(desktopAppleConfig({ VITE_KESTREL_SITE_URL: 'not a url' }), null);
});

test('the nonce is hashed as lower-case hex SHA-256, as Apple and Firebase expect', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the sign-in page gets only the state and the hashed nonce', () => {
  const url = new URL(appleSignInPageUrl({ servicesId: 'x', pageUrl: 'https://inflight.studio/apple-signin' }, { state: 's', hashedNonce: 'h' }));
  assert.equal(url.origin + url.pathname, 'https://inflight.studio/apple-signin');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['nonce', 'state']);
});

test('a matching answer gives the ID token and, on first sign-in, the name', () => {
  assert.deepEqual(appleAnswerFromQuery(`code=c&state=s1&id_token=${good}`, expected), { idToken: good });
  assert.deepEqual(appleAnswerFromQuery(`code=c&state=s1&id_token=${good}&first_name=Ada&last_name=Lovelace`, expected), { idToken: good, displayName: 'Ada Lovelace' });
});

test('answers for another attempt, app or nonce are refused, and a cancel says nothing changed', () => {
  assert.throws(() => appleAnswerFromQuery(`code=c&state=other&id_token=${good}`, expected), /did not match/);
  assert.throws(() => appleAnswerFromQuery('state=s1&error=popup_closed_by_user', expected), /cancelled/);
  assert.throws(() => appleAnswerFromQuery('state=s1&error=invalid_request', expected), /did not finish/);
  assert.throws(() => appleAnswerFromQuery('code=c&state=s1', expected), /did not confirm/);
  assert.throws(() => appleAnswerFromQuery('code=c&state=s1&id_token=a.!!!.c', expected), /did not confirm/);
  for (const claims of [{ aud: 'other' }, { nonce: 'other' }, { iss: 'https://evil.example' }]) {
    const bad = token({ iss: 'https://appleid.apple.com', aud: 'app.kestrel.photo.web', nonce: 'abc123', ...claims });
    assert.throws(() => appleAnswerFromQuery(`code=c&state=s1&id_token=${bad}`, expected), /not for this sign-in/);
  }
});

test('the website page hands back to 127.0.0.1 (the listener is IPv4 only; Safari may try ::1 for "localhost") on the listener\'s port and path', () => {
  const page = readFileSync(new URL('../../site/apple-signin.html', import.meta.url), 'utf8');
  const rust = readFileSync(new URL('../../src-tauri/src/oauth_loopback.rs', import.meta.url), 'utf8');
  const port = /pub const PORT: u16 = (\d+);/.exec(rust)![1];
  const path = /CALLBACK_PATH: &str = "([^"]+)"/.exec(rust)![1];
  assert.ok(page.includes(`var APP = 'http://127.0.0.1:${port}${path}';`));
  assert.ok(!/http:\/\/localhost/.test(page.replace(/\/\/.*$/gm, '')));
});

test('a refusal after Apple answered is explained in plain English', () => {
  assert.match(appleFirebaseFailureMessage({ code: 'auth/network-request-failed' }), /internet connection/);
  assert.match(appleFirebaseFailureMessage({ code: 'auth/invalid-credential' }), /auth\/invalid-credential/);
  assert.match(appleFirebaseFailureMessage(new Error('boom')), /did not finish: boom/);
  assert.match(appleFirebaseFailureMessage(null), /Nothing changed/);
});

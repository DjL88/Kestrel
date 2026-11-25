import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopGoogleClient, googleCodeExchangeBody, googleSignInUrl, idTokenFromAnswer } from './desktopGoogleSignIn.ts';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.c2ln`;

test('a dedicated sign-in client wins; the Google Drive desktop client is the fallback; neither means not set up', () => {
  assert.deepEqual(desktopGoogleClient({ VITE_GOOGLE_SIGNIN_CLIENT_ID: 'signin.apps.googleusercontent.com', VITE_GOOGLE_DRIVE_CLIENT_ID: 'drive.apps.googleusercontent.com' }),
    { clientId: 'signin.apps.googleusercontent.com', clientSecret: undefined });
  assert.deepEqual(desktopGoogleClient({ VITE_GOOGLE_DRIVE_CLIENT_ID: 'drive.apps.googleusercontent.com', VITE_GOOGLE_DRIVE_CLIENT_SECRET: 'GOCSPX-desktop' }),
    { clientId: 'drive.apps.googleusercontent.com', clientSecret: 'GOCSPX-desktop' });
  assert.equal(desktopGoogleClient({}), null);
  assert.equal(desktopGoogleClient({ VITE_GOOGLE_SIGNIN_CLIENT_ID: '  ' }), null);
});

test('the sign-in page asks only who the person is, with PKCE, a nonce and the loopback address', () => {
  const url = new URL(googleSignInUrl({ clientId: 'c', redirectUri: 'http://127.0.0.1:5555/callback', state: 's', challenge: 'ch', nonce: 'n' }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('nonce'), 'n');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:5555/callback');
  assert.equal(url.searchParams.get('access_type'), null);
});

test('the code exchange carries the verifier, and the secret only when the client has one', () => {
  const body = googleCodeExchangeBody({ clientId: 'c', code: 'code', verifier: 'v', redirectUri: 'r' });
  assert.equal(body.get('code_verifier'), 'v');
  assert.equal(body.has('client_secret'), false);
  assert.equal(googleCodeExchangeBody({ clientId: 'c', clientSecret: 'x', code: 'code', verifier: 'v', redirectUri: 'r' }).get('client_secret'), 'x');
});

test('only an ID token for this client and this attempt is accepted', () => {
  const good = token({ aud: 'c', nonce: 'n', email: 'a@example.test' });
  assert.equal(idTokenFromAnswer({ id_token: good }, { clientId: 'c', nonce: 'n' }), good);
  assert.throws(() => idTokenFromAnswer({ id_token: token({ aud: 'other', nonce: 'n' }) }, { clientId: 'c', nonce: 'n' }), /not for this sign-in/);
  assert.throws(() => idTokenFromAnswer({ id_token: token({ aud: 'c', nonce: 'old' }) }, { clientId: 'c', nonce: 'n' }), /not for this sign-in/);
  assert.throws(() => idTokenFromAnswer({ access_token: 'x' }, { clientId: 'c', nonce: 'n' }), /did not confirm/);
  assert.throws(() => idTokenFromAnswer({ id_token: 'a.!!!.c' }, { clientId: 'c', nonce: 'n' }), /did not confirm/);
});

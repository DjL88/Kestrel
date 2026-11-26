import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopMicrosoftClient, desktopMicrosoftRefused, microsoftCodeExchangeBody, microsoftIdTokenFromAnswer, microsoftSignInEnabled, microsoftSignInUrl } from './microsoftSignIn.ts';

const ENTRA = '2d7f2fd3-bf07-4afa-8707-8c4a9d643b7e';
const TID = '9188040d-6c67-4c5b-b112-36a304b66dad'; // Microsoft's tenant for personal accounts
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.c2ln`;
const good = token({ iss: `https://login.microsoftonline.com/${TID}/v2.0`, tid: TID, aud: ENTRA, nonce: 'hashed', sub: 'u' });

test('Microsoft is switched on per build, and the desktop route needs its own flag and an Entra client id', () => {
  assert.equal(microsoftSignInEnabled({}), false);
  assert.equal(microsoftSignInEnabled({ VITE_MICROSOFT_SIGN_IN: '1' }), true);
  assert.equal(desktopMicrosoftClient({ VITE_MICROSOFT_SIGN_IN: '1', VITE_ONEDRIVE_CLIENT_ID: ENTRA }), null, 'desktop flag is off by default');
  assert.equal(desktopMicrosoftClient({ VITE_MICROSOFT_DESKTOP_SIGNIN: 'on', VITE_ONEDRIVE_CLIENT_ID: ENTRA }), null, 'never without Microsoft switched on');
  assert.deepEqual(desktopMicrosoftClient({ VITE_MICROSOFT_SIGN_IN: '1', VITE_MICROSOFT_DESKTOP_SIGNIN: 'on', VITE_ONEDRIVE_CLIENT_ID: ENTRA }), { clientId: ENTRA });
  assert.deepEqual(desktopMicrosoftClient({ VITE_MICROSOFT_SIGN_IN: '1', VITE_MICROSOFT_DESKTOP_SIGNIN: 'on', VITE_MICROSOFT_SIGNIN_CLIENT_ID: ` ${ENTRA} `, VITE_ONEDRIVE_CLIENT_ID: 'x' }), { clientId: ENTRA });
  assert.equal(desktopMicrosoftClient({ VITE_MICROSOFT_SIGN_IN: '1', VITE_MICROSOFT_DESKTOP_SIGNIN: 'on', VITE_ONEDRIVE_CLIENT_ID: 'not-a-guid' }), null);
});

test("Microsoft's page asks only who the person is, with PKCE, a hashed nonce and the account picker", () => {
  const url = new URL(microsoftSignInUrl({ clientId: ENTRA, redirectUri: 'http://localhost:53682/oauth-callback', state: 's', challenge: 'c', hashedNonce: 'h' }));
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('nonce'), 'h');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:53682/oauth-callback');
});

test('the code exchange sends no secret', () => {
  const body = microsoftCodeExchangeBody({ clientId: ENTRA, code: 'k', verifier: 'v', redirectUri: 'r' });
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code_verifier'), 'v');
  assert.equal(body.has('client_secret'), false);
});

test("Microsoft's ID token is taken only when it is for this app, from Microsoft, for this attempt", () => {
  const expected = { clientId: ENTRA, hashedNonce: 'hashed' };
  assert.equal(microsoftIdTokenFromAnswer({ id_token: good }, expected), good);
  assert.throws(() => microsoftIdTokenFromAnswer({}, expected), /did not confirm/);
  assert.throws(() => microsoftIdTokenFromAnswer({ id_token: 'a.b' }, expected), /did not confirm/);
  assert.throws(() => microsoftIdTokenFromAnswer({ id_token: token({ iss: `https://login.microsoftonline.com/${TID}/v2.0`, tid: TID, aud: 'other', nonce: 'hashed' }) }, expected), /not for this sign-in/);
  assert.throws(() => microsoftIdTokenFromAnswer({ id_token: token({ iss: `https://login.microsoftonline.com/${TID}/v2.0`, tid: TID, aud: ENTRA, nonce: 'other' }) }, expected), /not for this sign-in/);
  assert.throws(() => microsoftIdTokenFromAnswer({ id_token: token({ iss: 'https://evil.example/v2.0', tid: TID, aud: ENTRA, nonce: 'hashed' }) }, expected), /not for this sign-in/);
});

test("Firebase's refusal of a desktop Microsoft token is recognised, but a provider that is off is not mistaken for it", () => {
  assert.equal(desktopMicrosoftRefused('auth/invalid-credential'), true);
  assert.equal(desktopMicrosoftRefused('auth/invalid-idp-response'), true);
  assert.equal(desktopMicrosoftRefused('auth/operation-not-allowed'), false);
  assert.equal(desktopMicrosoftRefused('auth/network-request-failed'), false);
});

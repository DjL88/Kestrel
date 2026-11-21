import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeUrl, challengeFor, CLOUD_DRIVES, exchangeBody, isConfigured, makeVerifier, needsRefresh, parseTokens, refreshBody } from './cloudDrive.ts';

test('the PKCE challenge matches the RFC 7636 example', async () => {
  assert.equal(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('a verifier needs enough randomness and is URL-safe', () => {
  assert.throws(() => makeVerifier(new Uint8Array(8)));
  assert.match(makeVerifier(new Uint8Array(32).fill(251)), /^[A-Za-z0-9_-]{43}$/);
});

test('authorise URLs carry S256 PKCE, the narrow scope and offline access', () => {
  const args = { clientId: 'client-123', redirectUri: 'https://app.test/oauth-callback.html', state: 's1', challenge: 'c1' };
  const drop = new URL(authorizeUrl(CLOUD_DRIVES.dropbox, args));
  assert.equal(drop.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(drop.searchParams.get('token_access_type'), 'offline');
  const google = new URL(authorizeUrl(CLOUD_DRIVES.googledrive, args));
  assert.equal(google.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(google.searchParams.get('access_type'), 'offline');
  const ms = new URL(authorizeUrl(CLOUD_DRIVES.onedrive, args));
  assert.match(ms.searchParams.get('scope') ?? '', /Files\.ReadWrite\.AppFolder/);
  assert.doesNotMatch(ms.searchParams.get('scope') ?? '', /Files\.ReadWrite(?!\.AppFolder)/);
});

test('no provider asks for access to the whole account', () => {
  for (const config of Object.values(CLOUD_DRIVES)) assert.ok(!config.scopes.some((scope) => /\/drive$|Files\.ReadWrite\.All|Files\.ReadWrite$/.test(scope)), config.name);
});

test('tokens are read, refreshed early and keep an earlier refresh token', () => {
  const tokens = parseTokens({ access_token: 'a', expires_in: 3600 }, 1000, 'r-old');
  assert.deepEqual(tokens, { accessToken: 'a', refreshToken: 'r-old', expiresAt: 1000 + 3_600_000 });
  assert.equal(needsRefresh(tokens, 1000 + 3_539_000), false);
  assert.equal(needsRefresh(tokens, 1000 + 3_541_000), true);
  assert.throws(() => parseTokens({}, 0));
});

test('exchange and refresh bodies include a secret only when one is given', () => {
  const base = { clientId: 'id', code: 'c', verifier: 'v', redirectUri: 'https://x/y' };
  assert.equal(exchangeBody(CLOUD_DRIVES.dropbox, base).has('client_secret'), false);
  assert.equal(exchangeBody(CLOUD_DRIVES.googledrive, { ...base, clientSecret: 's' }).get('client_secret'), 's');
  assert.equal(refreshBody({ clientId: 'id', refreshToken: 'r' }).get('grant_type'), 'refresh_token');
});

test('a provider is configured only when a real-looking client id is present', () => {
  assert.equal(isConfigured(undefined), false);
  assert.equal(isConfigured(''), false);
  assert.equal(isConfigured('abcdefghij'), true);
});

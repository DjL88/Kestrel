import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { firebaseIssuer } from '../src/oidcIdToken.ts';
import { startHarness, type Harness } from './helpers.ts';

const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'fb1', alg: 'RS256' } as JsonWebKey;
const PROJECT = 'kestrel-test-project';
const DEVICE = 'a'.repeat(64);

function firebaseToken(h: Harness, claims: Record<string, unknown> = {}) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'fb1' });
  const body = b64({ iss: firebaseIssuer(PROJECT), aud: PROJECT, sub: 'fb-user-1', email: 'cleo@example.com', email_verified: true,
    iat: Math.floor(h.clock.now / 1000), exp: Math.floor(h.clock.now / 1000) + 600, ...claims });
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pair.privateKey).toString('base64url')}`;
}
const start = () => startHarness(undefined, undefined, { env: { KCP_FIREBASE_PROJECT_ID: PROJECT }, firebaseKeys: async () => [jwk] });
const activate = (h: Harness, token: string) => h.call('POST', '/v1/me/activate', { token, body: { deviceHash: DEVICE, platform: 'macos', appVersion: '26.11.2' } });

test('signing in only creates a record; Pro needs a purchase or grant', async () => {
  const h = await start();
  try {
    const signIn = await h.call('POST', '/v1/auth/firebase', { body: { credential: firebaseToken(h) } });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.entitlementsAttached, 0);
    const me = await h.call('GET', '/v1/me/entitlements', { token: signIn.body.accessToken });
    assert.deepEqual(me.body.plans, []);
    const refused = await activate(h, signIn.body.accessToken);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error?.code ?? refused.body.code, 'NO_LICENCE');
  } finally { await h.close(); }
});

test('a paid licence waiting for the email attaches at sign-in and activates the device', async () => {
  const h = await start();
  try {
    await h.call('POST', '/v1/admin/licences/grant', { token: h.adminToken, body: { email: 'cleo@example.com', plan: 'paid', majorVersion: 1 } });
    const signIn = await h.call('POST', '/v1/auth/firebase', { body: { credential: firebaseToken(h) } });
    assert.equal(signIn.body.entitlementsAttached, 1);
    const ok = await activate(h, signIn.body.accessToken);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.grant && ok.body.activationId);
    const again = await activate(h, signIn.body.accessToken);
    assert.equal(again.status, 200, 'the same device activates again without using a second slot');
  } finally { await h.close(); }
});

test('an unverified email, another project or a bad signature is refused', async () => {
  const h = await start();
  try {
    const unverified = await h.call('POST', '/v1/auth/firebase', { body: { credential: firebaseToken(h, { email_verified: false }) } });
    assert.equal(unverified.status, 401);
    const other = await h.call('POST', '/v1/auth/firebase', { body: { credential: firebaseToken(h, { aud: 'someone-elses-project' }) } });
    assert.equal(other.status, 401);
    const forged = firebaseToken(h).split('.').slice(0, 2).join('.') + '.' + Buffer.from('nope').toString('base64url').padEnd(342, 'A');
    assert.equal((await h.call('POST', '/v1/auth/firebase', { body: { credential: forged } })).status, 401);
    assert.equal((await activate(h, 'not-a-token')).status, 401);
  } finally { await h.close(); }
});

test('without a configured project the route says sign-in is unavailable', async () => {
  const h = await startHarness(undefined, undefined, { firebaseKeys: async () => [jwk] });
  try {
    assert.equal((await h.call('POST', '/v1/auth/firebase', { body: { credential: firebaseToken(h) } })).status, 503);
  } finally { await h.close(); }
});
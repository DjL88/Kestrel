import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { APPLE_ISSUER } from '../src/oidcIdToken.ts';
import { startHarness, type Harness } from './helpers.ts';

const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', alg: 'RS256' } as JsonWebKey;
const AUDIENCE = 'com.example.kestrel.web';

function appleToken(h: Harness, claims: Record<string, unknown> = {}) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: 'RS256', kid: 'k1' });
  const body = b64({ iss: APPLE_ISSUER, aud: AUDIENCE, sub: 'apple-user-1', email: 'ann@example.com', email_verified: 'true',
    iat: Math.floor(h.clock.now / 1000), exp: Math.floor(h.clock.now / 1000) + 600, ...claims });
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), pair.privateKey).toString('base64url')}`;
}
const start = () => startHarness(undefined, undefined, { env: { KCP_APPLE_CLIENT_IDS: AUDIENCE }, appleKeys: async () => [jwk] });

test('a free grant waits for the person, then attaches when they sign in with Apple', async () => {
  const h = await start();
  try {
    const grant = await h.call('POST', '/v1/admin/licences/grant', { token: h.adminToken, body: { email: 'Ann@Example.com', plan: 'paid', majorVersion: 1, managedAi: true, note: 'Camera club prize' } });
    assert.equal(grant.status, 200);
    assert.equal(grant.body.created, true);
    assert.equal(grant.body.attachedNow, false, 'no account yet, so it waits');
    assert.ok(!JSON.stringify(grant.body).includes('example.com'), 'the address is not echoed back');

    const again = await h.call('POST', '/v1/admin/licences/grant', { token: h.adminToken, body: { email: 'ann@example.com', plan: 'paid', majorVersion: 1 } });
    assert.equal(again.body.created, false, 'pressing the button twice is harmless');

    const signIn = await h.call('POST', '/v1/auth/apple', { body: { credential: appleToken(h) } });
    assert.equal(signIn.status, 200);
    assert.equal(signIn.body.entitlementsAttached, 1);
    assert.ok(signIn.body.accessToken && signIn.body.refreshToken);

    const me = await h.call('GET', '/v1/me/entitlements', { token: signIn.body.accessToken });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.plans.map((p: any) => [p.plan, p.paid, p.source, p.majorVersion, p.managedAi]), [['paid', false, 'gift', 1, true]]);

    // Signing in again attaches nothing new and creates no second account.
    const second = await h.call('POST', '/v1/auth/apple', { body: { credential: appleToken(h) } });
    assert.equal(second.body.entitlementsAttached, 0);
  } finally { await h.close(); }
});

test('someone who signs in first is attached the moment a grant is made for their email', async () => {
  const h = await start();
  try {
    const signIn = await h.call('POST', '/v1/auth/apple', { body: { credential: appleToken(h, { email: 'bob@example.com', sub: 'b' }) } });
    assert.equal(signIn.body.entitlementsAttached, 0);
    const grant = await h.call('POST', '/v1/admin/licences/grant', { token: h.adminToken, body: { email: 'bob@example.com' } });
    assert.equal(grant.body.attachedNow, true, 'an existing account gets it straight away');
    const me = await h.call('GET', '/v1/me/entitlements', { token: signIn.body.accessToken });
    assert.equal(me.body.plans.length, 1);
  } finally { await h.close(); }
});

test('only an admin can grant, and a user session is never an admin session', async () => {
  const h = await start();
  try {
    const noToken = await h.call('POST', '/v1/admin/licences/grant', { body: { email: 'a@example.com' } });
    assert.equal(noToken.status, 401);
    const signIn = await h.call('POST', '/v1/auth/apple', { body: { credential: appleToken(h) } });
    const asUser = await h.call('POST', '/v1/admin/licences/grant', { token: signIn.body.accessToken, body: { email: 'a@example.com' } });
    assert.equal(asUser.status, 403);
  } finally { await h.close(); }
});

test('a token for another app, a bad signature, or no configured client id never signs anyone in', async () => {
  const h = await start();
  try {
    assert.equal((await h.call('POST', '/v1/auth/apple', { body: { credential: appleToken(h, { aud: 'com.someone.else' }) } })).status, 401);
    const bad = appleToken(h).split('.'); bad[2] = Buffer.from('nope').toString('base64url');
    assert.equal((await h.call('POST', '/v1/auth/apple', { body: { credential: bad.join('.') } })).status, 401);
    assert.equal((await h.call('POST', '/v1/auth/apple', { body: { credential: appleToken(h, { email_verified: 'false' }) } })).status, 401);
    assert.equal((await h.call('POST', '/v1/auth/google', { body: { credential: appleToken(h) } })).status, 503, 'Google client ids are not configured here');
  } finally { await h.close(); }
});

test('an Apple relay address is signed in, and the response says so', async () => {
  const h = await start();
  try {
    const r = await h.call('POST', '/v1/auth/apple', { body: { credential: appleToken(h, { email: 'x@privaterelay.appleid.com', is_private_email: 'true' }) } });
    assert.equal(r.status, 200);
    assert.equal(r.body.privateRelay, true);
  } finally { await h.close(); }
});

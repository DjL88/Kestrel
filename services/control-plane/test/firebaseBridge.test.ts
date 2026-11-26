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

test('account device management lists only the effective licence and releases another slot without activating the caller', async () => {
  const h = await start();
  try {
    const grant = await h.call('POST', '/v1/admin/licences/grant', { token: h.adminToken, body: { email: 'cleo@example.com', plan: 'paid', majorVersion: 1 } });
    assert.equal(grant.status, 200);
    const signIn = await h.call('POST', '/v1/auth/firebase', { body: { credential: firebaseToken(h) } });
    const token = signIn.body.accessToken;
    const other = await h.call('POST', '/v1/auth/firebase', { body: { credential: firebaseToken(h, { sub: 'fb-user-2', email: 'other@example.com' }) } });
    const otherToken = other.body.accessToken;
    const first = await activate(h, token);
    assert.equal(first.status, 200);
    const second = await h.call('POST', '/v1/me/activate', { token, body: { deviceHash: 'b'.repeat(64), platform: 'windows', appVersion: '26.11.2' } });
    assert.equal(second.status, 200);
    const devices = (as: string, hash = DEVICE) => h.call('POST', '/v1/me/devices', { token: as, body: { deviceHash: hash } });
    const release = (as: string, activationId: string) => h.call('POST', '/v1/me/devices/deactivate', { token: as, body: { deviceHash: DEVICE, activationId } });
    const listed = await devices(token);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.status, 'active');
    assert.equal(listed.body.devices.length, 2);
    assert.equal(listed.body.devices.find((d: any) => d.activationId === first.body.activationId).thisDevice, true);
    assert.equal(listed.body.devices.find((d: any) => d.activationId === second.body.activationId).thisDevice, false);
    assert.equal('deviceHash' in listed.body.devices[0], false);
    assert.deepEqual((await devices(otherToken)).body.devices, []);
    assert.equal((await release(otherToken, second.body.activationId)).status, 404);
    assert.equal((await release(token, first.body.activationId)).status, 400);
    assert.equal((await devices(token, 'c'.repeat(64))).body.devices.length, 2, 'listing from a new device must not occupy a slot');
    assert.equal((await release(token, second.body.activationId)).status, 200);
    assert.equal((await devices(token)).body.devices.length, 1);
    assert.equal((await release(token, second.body.activationId)).status, 404);
    assert.equal((await h.call('POST', '/v1/me/devices', { body: { deviceHash: DEVICE } })).status, 401);
  } finally { await h.close(); }
});

test('Microsoft sign-in: an unproved work-account email is refused, and once proved it reaches the same account as Google', async () => {
  const h = await start();
  try {
    await h.call('POST', '/v1/admin/licences/grant', { token: h.adminToken, body: { email: 'cleo@example.com', plan: 'paid', majorVersion: 1 } });
    const viaMicrosoft = (verified: boolean) => firebaseToken(h, { email_verified: verified, firebase: { sign_in_provider: 'microsoft.com', identities: { 'microsoft.com': ['ms-oid-1'] } } });
    // Firebase does not vouch for a Microsoft address (an organisation sets it), so the server must not take it on trust.
    assert.equal((await h.call('POST', '/v1/auth/firebase', { body: { credential: viaMicrosoft(false) } })).status, 401);
    const google = await h.call('POST', '/v1/auth/firebase', { body: { credential: firebaseToken(h, { firebase: { sign_in_provider: 'google.com' } }) } });
    const microsoft = await h.call('POST', '/v1/auth/firebase', { body: { credential: viaMicrosoft(true) } });
    assert.equal(microsoft.status, 200);
    const plans = async (token: string) => (await h.call('GET', '/v1/me/entitlements', { token })).body.plans;
    assert.deepEqual(await plans(microsoft.body.accessToken), await plans(google.body.accessToken), 'the same email has the same access');
    assert.ok((await plans(microsoft.body.accessToken)).length > 0);
  } finally { await h.close(); }
});

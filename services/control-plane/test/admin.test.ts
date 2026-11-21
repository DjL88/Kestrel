/**
 * The admin console's server side: Google sign-in limited to an allow-list, licensees and devices, gift keys with a
 * note and expiry, usage, payments and the contact inbox. Every admin call is audited. Runs on SQLite here and on
 * Firestore in admin.firestore.test.ts.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signSession } from '../src/crypto.ts';
import { image, startHarness, type Harness } from './helpers.ts';

const CLIENT_ID = 'kestrel-admin.apps.googleusercontent.com';
const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(google.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'google-1', alg: 'RS256', use: 'sig' };

let h: Harness;
before(async () => {
  h = await startHarness(undefined, undefined, {
    env: { KCP_GOOGLE_CLIENT_ID: CLIENT_ID, KCP_ADMIN_EMAILS: 'Owner@Example.test, admin@example.test' },
    googleKeys: async () => [jwk],
  });
});
after(async () => { await h.close(); });

function idToken(claims: Record<string, unknown> = {}, key = google.privateKey, kid = 'google-1') {
  const now = Math.floor(h.clock.now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234', email: 'owner@example.test', email_verified: true, iat: now, exp: now + 3600, ...claims })).toString('base64url');
  return `${header}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), key).toString('base64url')}`;
}
const googleSignIn = (credential: string) => h.call('POST', '/v1/admin/session/google', { body: { credential } });
const device = (name: string) => crypto.createHash('sha256').update(name).digest('hex');

test('the admin page learns how to sign in without seeing any data', async () => {
  const config = await h.call('GET', '/v1/admin/config');
  assert.deepEqual(config.body, { googleClientId: CLIENT_ID, passwordSignIn: false });
});

test('Google sign-in works only for an allow-listed, verified account with a genuine token for this site', async () => {
  const ok = await googleSignIn(idToken());
  assert.equal(ok.status, 200);
  assert.equal(ok.body.expiresIn, 900);
  assert.equal(ok.body.refreshToken, undefined, 'no refresh token: the page asks Google again');
  assert.equal((await h.call('GET', '/v1/admin/licensees', { token: ok.body.accessToken })).status, 200);
  assert.equal((await googleSignIn(idToken())).status, 200, 'signing in again reuses the same account');

  for (const [claims, key, kid, status] of [
    [{ aud: 'someone-else.apps.googleusercontent.com' }, google.privateKey, 'google-1', 401],
    [{ iss: 'https://evil.example' }, google.privateKey, 'google-1', 401],
    [{ exp: Math.floor(h.clock.now / 1000) - 3600 }, google.privateKey, 'google-1', 401],
    [{ email_verified: false }, google.privateKey, 'google-1', 401],
    [{}, stranger.privateKey, 'google-1', 401],
    [{}, google.privateKey, 'unknown-kid', 401],
    [{ email: 'intruder@example.test' }, google.privateKey, 'google-1', 403],
  ] as const) {
    const refused = await googleSignIn(idToken(claims, key, kid));
    assert.equal(refused.status, status, JSON.stringify(claims) + kid);
  }
  assert.equal((await googleSignIn('not-a-token-at-all-but-long-enough')).status, 401);
  const denied = (await h.app.store.listAudit(500)).filter((e) => e.action === 'admin.signin' && e.outcome === 'denied');
  assert.equal(denied.length, 8, 'every refused sign-in is audited');
  assert.ok(denied.every((e) => !e.detail.includes('intruder')), 'refused emails are not written to the audit log');
});

test('with an allow-list, an admin role on its own is not enough', async () => {
  const otherAdmin = await h.app.createAccount('other-admin@example.test', 'other-admin-password', 'admin');
  const token = signSession(otherAdmin, 'admin', h.app.config.sessionSecret, h.clock.now);
  const response = await h.call('GET', '/v1/admin/licensees', { token });
  assert.equal(response.status, 403);
  const entry = (await h.app.store.listAudit(50)).find((e) => e.actor === otherAdmin);
  assert.equal(entry?.detail, 'not on the admin allow-list');
});

test('a gift key carries a note and a server-side expiry; devices can be listed and freed', async () => {
  const issued = await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid', maxDevices: 1, note: 'Gift for the camera club', validDays: 30 } });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.validUntilMs, h.clock.now + 30 * 86_400_000);
  const activate = (name: string) => h.call('POST', '/v1/licences/activate', { body: { licenceKey: issued.body.licenceKey, deviceHash: device(name), platform: 'macos', appVersion: '26.11.2' } });
  assert.equal((await activate('mac')).status, 200);
  assert.equal((await activate('laptop')).status, 409, 'one device only');

  const list = await h.call('GET', '/v1/admin/licensees', { token: h.adminToken });
  const licence = list.body.licences.find((l: { licenceId: string }) => l.licenceId === issued.body.licenceId);
  assert.equal(licence.note, 'Gift for the camera club');
  assert.equal(licence.devices.length, 1);
  assert.equal(licence.devices[0].platform, 'macos');
  assert.equal(licence.devices[0].deviceHashPrefix.length, 12, 'only a prefix of the device hash leaves the server');

  const freed = await h.call('POST', `/v1/admin/devices/${licence.devices[0].activationId}/deactivate`, { token: h.adminToken });
  assert.equal(freed.status, 200);
  assert.equal((await h.call('POST', '/v1/admin/devices/act_missing/deactivate', { token: h.adminToken })).status, 404);
  assert.equal((await activate('laptop')).status, 200, 'the freed slot can be used');

  const saved = h.clock.now;
  h.clock.now += 31 * 86_400_000;
  try {
    assert.equal((await activate('laptop')).status, 403, 'after the expiry, activation and renewal stop');
  } finally { h.clock.now = saved; }
  assert.equal((await h.call('POST', `/v1/admin/licences/${issued.body.licenceId}/revoke`, { token: h.adminToken })).status, 200);
});

test('usage shows each account\'s AI allowance; payments say when SumUp is not connected', async () => {
  await h.app.store.setAiConsent(h.user.accountId, true);
  assert.equal((await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(), userConsent: true } })).status, 200);
  const usage = await h.call('GET', '/v1/admin/usage', { token: h.adminToken });
  const mine = usage.body.accounts.find((a: { accountId: string }) => a.accountId === h.user.accountId);
  assert.equal(mine.requestsUsed, 1);
  const payments = await h.call('GET', '/v1/admin/payments', { token: h.adminToken });
  assert.deepEqual({ connected: payments.body.connected, transactions: payments.body.transactions }, { connected: false, transactions: [] });
  assert.equal((await h.call('GET', '/v1/admin/payments', { token: h.user.token })).status, 403);
});

test('payments list paid checkouts from the commerce ledger', async () => {
  const sale = {
    checkoutReference: 'kp_1', invoiceNumber: 'KP-2026-0001', paidAt: '2026-11-18T12:00:00Z', status: 'paid', country: 'GB', currency: 'GBP',
    totalPence: 2900, netPence: 2900, taxPence: 0, accountId: null, secretThing: 'not shown',
  };
  const withLedger = await startHarness(undefined, undefined, { payments: { listTransactions: async () => [sale as never] } });
  try {
    const payments = await withLedger.call('GET', '/v1/admin/payments', { token: withLedger.adminToken });
    assert.equal(payments.body.connected, true);
    assert.equal(payments.body.transactions[0].invoiceNumber, 'KP-2026-0001');
    assert.equal(payments.body.transactions[0].secretThing, undefined, 'only the listed fields are sent');
  } finally { await withLedger.close(); }
});

test('the contact form stores consented messages, drops robots, and is rate-limited; the inbox tracks status', async () => {
  const message = { name: 'Alex', email: 'alex@example.test', message: 'Does Pro work on two laptops?', consent: true };
  assert.equal((await h.call('POST', '/v1/contact', { body: { ...message, consent: false } })).status, 400);
  assert.equal((await h.call('POST', '/v1/contact', { body: { ...message, website: 'http://spam.example' } })).status, 200);
  assert.equal((await h.call('POST', '/v1/contact', { body: message })).status, 200);
  const inbox = await h.call('GET', '/v1/admin/messages', { token: h.adminToken });
  assert.equal(inbox.body.messages.length, 1, 'the robot message was not stored');
  assert.equal(inbox.body.messages[0].status, 'new');
  const id = inbox.body.messages[0].messageId;
  assert.equal((await h.call('POST', `/v1/admin/messages/${id}/status`, { token: h.adminToken, body: { status: 'answered' } })).status, 200);
  assert.equal((await h.call('GET', '/v1/admin/messages', { token: h.adminToken })).body.messages[0].status, 'answered');
  assert.equal((await h.call('POST', '/v1/admin/messages/msg_missing/status', { token: h.adminToken, body: { status: 'read' } })).status, 404);
  assert.equal((await h.call('GET', '/v1/admin/messages', { token: h.user.token })).status, 403);

  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await h.call('POST', '/v1/contact', { body: message })).status);
  assert.ok(statuses.includes(429), 'more than five messages in ten minutes from one address are refused');
});

test('every admin read and action is audited', async () => {
  const actions = new Set((await h.app.store.listAudit(1000)).filter((e) => e.outcome === 'allowed').map((e) => e.action));
  for (const action of ['admin.signin', 'licensees.read', 'licence.issue', 'device.deactivate', 'licence.revoke', 'usage.read', 'payments.read', 'messages.read', 'message.status']) {
    assert.ok(actions.has(action), action);
  }
});

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


test('an admin makes someone a contributor: free Pro, and their "Feedback on this" lands in the admin inbox', async () => {
  const h = await start();
  try {
    const signIn = await h.call('POST', '/v1/auth/apple', { body: { credential: appleToken(h) } });
    const session = signIn.body.accessToken;
    const before = await h.call('GET', '/v1/me/entitlements', { token: session });
    assert.equal(before.body.contributor, false);
    const refused = await h.call('POST', '/v1/me/feedback', { token: session, body: { comment: 'Hello' } });
    assert.equal(refused.status, 403, 'only contributors can send feedback');

    // An ordinary free Pro grant for the same person does not hide the contributor grant, and neither replaces the other.
    await h.call('POST', '/v1/admin/licences/grant', { token: h.adminToken, body: { email: 'ann@example.com', majorVersion: 2 } });
    const grant = await h.call('POST', '/v1/admin/licences/grant', { token: h.adminToken, body: { email: 'ann@example.com', majorVersion: 2, contributor: true } });
    assert.equal(grant.status, 200);
    assert.equal(grant.body.created, true);
    assert.equal(grant.body.attachedNow, true);
    assert.match(grant.body.licenceId, /^lic_c_/);

    const me = await h.call('GET', '/v1/me/entitlements', { token: session });
    assert.equal(me.body.contributor, true);
    assert.deepEqual(me.body.plans.map((p: any) => [p.plan, p.paid, p.source]), [['paid', false, 'gift'], ['paid', false, 'gift']]);

    const sent = await h.call('POST', '/v1/me/feedback', { token: session, body: {
      comment: '"Entwurf" reads oddly here; "Vorschau" is better.', target: 'button "Exportieren"', text: 'Exportieren', screen: 'editor · export', language: 'de', appVersion: '2.0.0',
    } });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.received, true);
    const bad = await h.call('POST', '/v1/me/feedback', { token: session, body: { comment: '' } });
    assert.equal(bad.status, 400, 'an empty comment is refused');

    const inbox = await h.call('GET', '/v1/admin/messages', { token: h.adminToken });
    assert.equal(inbox.body.messages.length, 1);
    const m = inbox.body.messages[0];
    assert.equal(m.name, 'Contributor feedback (de)');
    assert.equal(m.email, '');
    assert.match(m.message, /Vorschau/);
    assert.match(m.message, /Screen: editor · export/);
    assert.match(m.message, /Words shown: Exportieren/);
    assert.ok(!m.message.includes('example.com'), 'no address is kept with the feedback');

    // Revoking the contributor grant turns feedback off again.
    const revoke = await h.call('POST', `/v1/admin/licences/${grant.body.licenceId}/revoke`, { token: h.adminToken, body: {} });
    assert.equal(revoke.status, 200);
    const after = await h.call('GET', '/v1/me/entitlements', { token: session });
    assert.equal(after.body.contributor, false);
    assert.equal((await h.call('POST', '/v1/me/feedback', { token: session, body: { comment: 'Hello' } })).status, 403);
  } finally { await h.close(); }
});

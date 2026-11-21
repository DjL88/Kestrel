import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { APPLE_ISSUER, verifyOidcIdToken, type OidcKeys } from '../src/oidcIdToken.ts';

const NOW = Date.UTC(2026, 10, 21, 12);
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', alg: 'RS256', use: 'sig' } as JsonWebKey;
const keys: OidcKeys = async () => [jwk];
const expectApple = { issuers: [APPLE_ISSUER], audiences: ['com.example.kestrel.web', 'com.example.kestrel'] };

function token(claims: Record<string, unknown>, options: { key?: crypto.KeyObject; kid?: string; alg?: string } = {}): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = b64({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'k1' });
  const body = b64({ iss: APPLE_ISSUER, aud: 'com.example.kestrel.web', sub: 'u1', email: 'Ann@Example.com', email_verified: 'true',
    iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 600, ...claims });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), options.key ?? pair.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const check = (t: string, k: OidcKeys = keys) => verifyOidcIdToken(t, expectApple, k, NOW);

test('a good Apple token passes, with the email lower-cased and email_verified accepted as a string', async () => {
  const r = await check(token({}));
  assert.deepEqual(r, { ok: true, email: 'ann@example.com', subject: 'u1', privateRelay: false });
});

test('a relay address is flagged so the app can explain why a purchase made with another email does not match', async () => {
  const r = await check(token({ email: 'abc@privaterelay.appleid.com', is_private_email: 'true' }));
  assert.equal(r.ok && r.privateRelay, true);
});

test('wrong key, wrong audience, wrong issuer, expired and unverified email are all refused', async () => {
  assert.deepEqual(await check(token({}, { key: other.privateKey })), { ok: false, reason: 'signature' });
  assert.deepEqual(await check(token({ aud: 'com.someone.else' })), { ok: false, reason: 'audience' });
  assert.deepEqual(await check(token({ aud: ['x', 'com.example.kestrel'] })), { ok: true, email: 'ann@example.com', subject: 'u1', privateRelay: false });
  assert.deepEqual(await check(token({ iss: 'https://evil.example' })), { ok: false, reason: 'issuer' });
  assert.deepEqual(await check(token({ exp: Math.floor(NOW / 1000) - 3600 })), { ok: false, reason: 'expired' });
  assert.deepEqual(await check(token({ email_verified: 'false' })), { ok: false, reason: 'email_unverified' });
  assert.deepEqual(await check(token({ email_verified: undefined })), { ok: false, reason: 'email_unverified' });
});

test('malformed tokens, an unknown key id, none-algorithm and an unreachable key service fail closed', async () => {
  assert.deepEqual(await check('abc'), { ok: false, reason: 'format' });
  assert.deepEqual(await check(token({}, { alg: 'none' })), { ok: false, reason: 'format' });
  assert.deepEqual(await check(token({}, { kid: 'nope' })), { ok: false, reason: 'signature' });
  assert.deepEqual(await check(token({}), async () => { throw new Error('offline'); }), { ok: false, reason: 'keys_unavailable' });
  assert.deepEqual(await verifyOidcIdToken(token({}), { issuers: [APPLE_ISSUER], audiences: [] }, keys, NOW), { ok: false, reason: 'audience' }, 'no configured client id means nothing is accepted');
});

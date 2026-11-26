import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { verifyLicence } from './licence.ts';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const issue = (details: object = { v: 1, plan: 'paid', id: 'abc', issuedAt: 1 }) => {
  const body = Buffer.from(JSON.stringify(details));
  return `KESTREL1.${body.toString('base64url')}.${sign(null, body, privateKey).toString('base64url')}`;
};

test('a key signed by the owner is accepted, with no network', async () => {
  const result = await verifyLicence(issue(), publicRaw);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.details.plan, 'paid');
});

test('surrounding spaces from copy and paste are tolerated', async () => {
  assert.equal((await verifyLicence(`  ${issue()}\n`, publicRaw)).ok, true);
});

test('a changed key is refused', async () => {
  const key = issue();
  const [head, body, signature] = key.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id: 'other', issuedAt: 1 })).toString('base64url');
  assert.deepEqual(await verifyLicence(`${head}.${forged}.${signature}`, publicRaw), { ok: false, reason: 'signature' });
  assert.equal(body.length > 0, true);
});

test('a key signed by someone else is refused', async () => {
  const other = generateKeyPairSync('ed25519');
  const body = Buffer.from(JSON.stringify({ v: 1, plan: 'paid', id: 'x', issuedAt: 1 }));
  const key = `KESTREL1.${body.toString('base64url')}.${sign(null, body, other.privateKey).toString('base64url')}`;
  assert.deepEqual(await verifyLicence(key, publicRaw), { ok: false, reason: 'signature' });
});

test('anything else a person pastes is just "not a key", and never throws', async () => {
  for (const junk of ['', 'hello', 'KESTREL1.a.b', 'KESTREL1..', 'OTHER.x.y', 'KESTREL1.%%%.%%%', `KESTREL1.${Buffer.from('{"v":2}').toString('base64url')}.AA`]) {
    const result = await verifyLicence(junk, publicRaw);
    assert.equal(result.ok, false, junk);
  }
});

test('the app’s built-in public key accepts a key from the owner’s issuing tool', async () => {
  const { execFileSync } = await import('node:child_process');
  const { homedir } = await import('node:os');
  const { existsSync } = await import('node:fs');
  const keyFile = `${homedir()}/.kestrel-signing/licence.key.pem`;
  if (!existsSync(keyFile)) return; // Only the owner's machine has the private key.
  const { LICENCE_PUBLIC_KEY } = await import('./licence.ts');
  const key = execFileSync('node', ['tools/licence/issue.mjs'], { encoding: 'utf8' }).trim();
  assert.equal((await verifyLicence(key, LICENCE_PUBLIC_KEY)).ok, true);
});

test('a key carries the version bought: it unlocks that version and older builds, never a later paid version', async () => {
  const { PRODUCT_MAJOR_VERSION } = await import('./licence.ts');
  assert.equal((await verifyLicence(issue({ v: 1, plan: 'paid', id: 'abc', issuedAt: 1, major: PRODUCT_MAJOR_VERSION }), publicRaw)).ok, true);
  // A key from before `major` existed covers InFlight 1.
  assert.equal((await verifyLicence(issue(), publicRaw, 1)).ok, true);
  assert.deepEqual(await verifyLicence(issue(), publicRaw, 2), { ok: false, reason: 'older_version' });
  assert.deepEqual(await verifyLicence(issue({ v: 1, plan: 'paid', id: 'abc', issuedAt: 1, major: 1 }), publicRaw, 2), { ok: false, reason: 'older_version' });
  assert.equal((await verifyLicence(issue({ v: 1, plan: 'paid', id: 'abc', issuedAt: 1, major: 2 }), publicRaw, 2)).ok, true);
  // The server serves every version.
  assert.equal((await verifyLicence(issue({ v: 1, plan: 'paid', id: 'abc', issuedAt: 1, major: 1 }), publicRaw, null)).ok, true);
  for (const major of [0, 1.5, '2', -1]) assert.deepEqual(await verifyLicence(issue({ v: 1, plan: 'paid', id: 'abc', issuedAt: 1, major }), publicRaw), { ok: false, reason: 'format' });
});

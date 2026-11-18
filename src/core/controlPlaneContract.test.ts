/** The client half of the control-plane contract: signatures, grants, JPEG checks and recipe proposals. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { canonicalJson, openEnvelope } from './signedEnvelope';
import { parseEntitlementGrant, snapshotFromGrant, verifyEntitlementGrant, type EntitlementGrant } from './entitlementGrant';
import { assetReadiness } from './modelDelivery';
import { inspectJpeg } from './jpegInspect';
import { parseRecipeProposal } from './recipeProposal';

const subtle = webcrypto.subtle;
const toBase64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString('base64');

async function signer() {
  const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = toBase64(await subtle.exportKey('raw', pair.publicKey));
  const sign = async <T>(payload: T, keyId = 'k1') => ({
    payload, keyId,
    signature: toBase64(await subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(canonicalJson(payload)))),
  });
  return { keys: { k1: publicKey }, sign };
}

const DAY = 86_400_000;
const grant = (extra: Partial<EntitlementGrant> = {}): EntitlementGrant => ({
  schema: 1, grantId: 'grt_abcdefgh', plan: 'paid', managedAi: false, deviceHash: 'd'.repeat(64),
  issuedAtMs: 1_000 * DAY, offlineUntilMs: 1_030 * DAY, ...extra,
});

test('canonical JSON is key-order independent and refuses values JSON cannot carry exactly', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.throws(() => canonicalJson({ a: Number.NaN }));
  assert.throws(() => canonicalJson({ a: 1n }));
});

test('an envelope opens only with a pinned key and an untouched payload', async () => {
  const { keys, sign } = await signer();
  const envelope = await sign({ hello: 'world' });
  assert.deepEqual(await openEnvelope(envelope, keys), { payload: { hello: 'world' } });
  assert.deepEqual(await openEnvelope({ ...envelope, payload: { hello: 'there' } }, keys), { failure: 'bad_signature' });
  assert.deepEqual(await openEnvelope({ ...envelope, keyId: 'k2' }, keys), { failure: 'unknown_key' });
  assert.deepEqual(await openEnvelope({ ...envelope, keyId: '__proto__' }, keys), { failure: 'unknown_key' });
  for (const bad of [null, [], 'x', { payload: 1 }, { ...envelope, signature: 'not base64!' }]) {
    assert.deepEqual(await openEnvelope(bad, keys), { failure: 'malformed' });
  }
});

test('grants are strict: unknown fields, other devices and windows over 90 days are refused', async () => {
  const { keys, sign } = await signer();
  assert.ok(parseEntitlementGrant(grant()));
  assert.equal(parseEntitlementGrant({ ...grant(), extra: true }), null);
  assert.equal(parseEntitlementGrant(grant({ plan: 'pro' as never })), null);
  assert.equal(parseEntitlementGrant(grant({ offlineUntilMs: 1_000 * DAY + 91 * DAY })), null);
  assert.equal(parseEntitlementGrant(grant({ offlineUntilMs: 999 * DAY })), null);
  const envelope = await sign(grant());
  assert.equal((await verifyEntitlementGrant(envelope, keys, 'd'.repeat(64))).ok, true);
  assert.deepEqual(await verifyEntitlementGrant(envelope, keys, 'e'.repeat(64)), { ok: false, reason: 'other_device' });
});

test('a grant keeps paid tools for its whole offline window, then falls back to Free without locking anything', () => {
  const within = snapshotFromGrant(grant(), 1_029 * DAY, false);
  assert.equal(within.licence, 'active');
  assert.equal(within.cachedLocalLicence, true);
  const past = snapshotFromGrant(grant(), 1_031 * DAY, false);
  assert.equal(past.licence, 'unverified');
  assert.equal(past.cachedLocalLicence, false);
  assert.equal(snapshotFromGrant(null, 0, true).plan, 'free');
  assert.equal(snapshotFromGrant(grant({ plan: 'free' }), 1_001 * DAY, true).plan, 'free');
});

test('JPEG inspection reads size and spots EXIF or XMP without decoding pixels', () => {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x02];
  const exif = [...Buffer.from('Exif\0\0MM')];
  const plain = Uint8Array.from([0xff, 0xd8, ...sof, ...sos, 0xff, 0xd9]);
  assert.deepEqual(inspectJpeg(plain), { width: 640, height: 480, hasMetadata: false });
  const withExif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, exif.length + 2, ...exif, ...sof, ...sos]);
  assert.equal(inspectJpeg(withExif)?.hasMetadata, true);
  assert.equal(inspectJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), null, 'a PNG is not a JPEG');
  assert.equal(inspectJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff])), null, 'a segment longer than the file');
});

test('recipe proposals keep only known sliders, clamped and rounded; {} means already balanced', () => {
  assert.deepEqual(parseRecipeProposal('{"exposure":0.333,"shadows":9,"denoise":-1,"masks":[1],"evil":"rm -rf"}'), { exposure: 0.35, shadows: 2 });
  assert.deepEqual(parseRecipeProposal('```json\n{}\n```'), {});
  assert.deepEqual(parseRecipeProposal({ exposure: 0.01 }), {}, 'a change too small to see is no change');
  assert.equal(parseRecipeProposal('not json'), null);
  assert.equal(parseRecipeProposal([1, 2]), null);
});

test('readiness words say what is installed and why an update was refused', () => {
  const installed = { id: 'species-model', version: '2026.11.1', sha256: 'a'.repeat(64) };
  assert.equal(assetReadiness(null, null), 'Not installed');
  assert.equal(assetReadiness(installed, null), 'Ready: 2026.11.1');
  assert.equal(assetReadiness(installed, { action: 'keep_previous', installed, reason: 'checksum_mismatch' }), 'Update rejected (checksum mismatch); still using 2026.11.1.');
});

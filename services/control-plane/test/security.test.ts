/**
 * The twelve negative scenarios the control plane must pass before it is
 * trusted with anything (Kestrel blueprint section 2.5). Each test names the
 * scenario it covers.
 */
import test, { after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signSession, signWebhook } from '../src/crypto.ts';
import { identify } from '../src/gateway.ts';
import { ApiError } from '../src/http.ts';
import { verifyEntitlementGrant, snapshotFromGrant } from '../../../src/core/entitlementGrant.ts';
import { accessCapabilities } from '../../../src/core/commercialAccess.ts';
import { parseDataManifest } from '../../../src/core/dataUpdateManifest.ts';
import { openSignedDataManifest, stageDownloadedAsset } from '../../../src/core/modelDelivery.ts';
import { fakeProvider, image, startHarness, type Harness } from './helpers.ts';

let h: Harness;
const provider = fakeProvider();
before(async () => { h = await startHarness(provider); });
after(async () => { await h.close(); });

const webhook = (body: object, secret = h.app.config.webhookSecret, at = h.clock.now) => {
  const raw = JSON.stringify(body);
  return h.call('POST', '/v1/billing/webhook', { raw, headers: { 'content-type': 'application/json', 'kestrel-signature': signWebhook(raw, secret, Math.floor(at / 1000)) } });
};
const licencePlan = async (id: string) => { const l = await h.app.store.getLicence(id); return l && { plan: l.plan, status: l.status }; };

test('1. unsigned or wrongly signed billing webhooks are rejected with 401', async () => {
  const event = { id: 'evt_unsigned', type: 'licence.created', data: { licenceId: 'lic_unsigned', plan: 'paid' } };
  const missing = await h.call('POST', '/v1/billing/webhook', { body: event });
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error.code, 'WEBHOOK_SIGNATURE_INVALID');
  const wrong = await webhook(event, 'not-the-secret');
  assert.equal(wrong.status, 401);
  const stale = await webhook(event, undefined, h.clock.now - 10 * 60_000);
  assert.equal(stale.status, 401, 'outside the 5-minute replay window');
  assert.equal(await licencePlan('lic_unsigned'), undefined, 'nothing was written');
});

test('2. a replayed billing event is refused with 409 and changes nothing', async () => {
  const first = await webhook({ id: 'evt_once', type: 'licence.created', data: { licenceId: 'lic_once', plan: 'paid' } });
  assert.equal(first.status, 200);
  const replay = await webhook({ id: 'evt_once', type: 'licence.revoked', data: { licenceId: 'lic_once' } });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.error.code, 'WEBHOOK_REPLAYED');
  assert.deepEqual({ ...(await licencePlan('lic_once')) }, { plan: 'paid', status: 'active' });
});

test('3. a normal user calling an admin endpoint gets 403 and the attempt is audited', async () => {
  const response = await h.call('GET', '/v1/admin/overview', { token: h.user.token });
  assert.equal(response.status, 403);
  const entry = (await h.app.store.listAudit(200)).find((e) => e.actor === h.user.accountId && e.action === 'overview');
  assert.equal(entry?.outcome, 'denied');
  const anonymous = await h.call('POST', '/v1/admin/ai/killswitch', { body: { aiDisabled: true } });
  assert.equal(anonymous.status, 401);
  assert.equal(await h.app.store.getSetting('ai_disabled'), undefined, 'the switch was not touched');
});

test('4. an expired session token on /v1/ai/* gets AUTH_TOKEN_EXPIRED', async () => {
  const expired = signSession(h.user.accountId, 'user', h.app.config.sessionSecret, h.clock.now - 16 * 60_000);
  const response = await h.call('POST', '/v1/ai/identify', { token: expired, body: { image: image(), userConsent: true } });
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_TOKEN_EXPIRED');
  const forged = signSession(h.user.accountId, 'admin', crypto.randomBytes(32), h.clock.now);
  const forgedResponse = await h.call('GET', '/v1/admin/overview', { token: forged });
  assert.equal(forgedResponse.body.error.code, 'AUTH_TOKEN_INVALID');
});

test('5. no explicit consent, or camera metadata still present, means the photo is not sent', async () => {
  const before = provider.calls;
  const noConsent = await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(), userConsent: false } });
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.body.error.code, 'CONSENT_REQUIRED');
  const missingConsent = await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image() } });
  assert.equal(missingConsent.status, 400);
  const withExif = await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(640, 480, { exif: true }), userConsent: true } });
  assert.equal(withExif.status, 400);
  assert.equal(withExif.body.error.code, 'IMAGE_HAS_METADATA');
  assert.equal(provider.calls, before, 'the provider never saw any of them');
});

test('6. images over 512 KB or 1024 px are refused with 413', async () => {
  const heavy = await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(800, 600, { padTo: 512 * 1024 + 1 }), userConsent: true } });
  assert.equal(heavy.status, 413);
  const wide = await h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(1025, 600), userConsent: true } });
  assert.equal(wide.status, 413);
  assert.equal(wide.body.error.code, 'IMAGE_TOO_LARGE');
  const huge = await h.call('POST', '/v1/ai/identify', { token: h.user.token, raw: 'x'.repeat(900 * 1024), headers: { 'content-type': 'application/json' } });
  assert.equal(huge.status, 413, 'the body itself is capped before parsing');
});

test('7. malformed or out-of-range upstream answers are rejected or clamped, never passed through', async () => {
  const broken = await startHarness(fakeProvider({
    identify: async () => 'Sure! It is <b>probably</b> a kingfisher http://evil.example',
    suggest: async () => JSON.stringify({ exposure: 99, shadows: -50, denoise: -1, deleteOriginal: true, pixels: [1, 2, 3], warmth: 'hot' }),
  }));
  try {
    const identifyResponse = await broken.call('POST', '/v1/ai/identify', { token: broken.user.token, body: { image: image(), userConsent: true } });
    assert.equal(identifyResponse.status, 502);
    assert.equal(identifyResponse.body.error.code, 'AI_UPSTREAM_MALFORMED');
    assert.equal(identifyResponse.body.error.retryable, true);
    const used = await broken.app.store.getQuota(broken.user.accountId);
    assert.equal(used?.requestsUsed, 0, 'a failed answer is refunded');
    const suggestResponse = await broken.call('POST', '/v1/ai/suggest', { token: broken.user.token, body: { image: image(), userConsent: true } });
    assert.equal(suggestResponse.status, 200);
    assert.deepEqual(suggestResponse.body.proposal, { exposure: 2, shadows: -2 }, 'clamped to slider ranges; unknown keys and non-numbers dropped');
  } finally { await broken.close(); }
});

test('8. ten concurrent requests against one remaining unit: exactly one succeeds, nine get 429', async () => {
  const race = await startHarness(fakeProvider({ identify: () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({ kind: 'wildlife', species: null, confidence: 'low', tags: [] })), 30)) }));
  try {
    const set = await race.call('POST', '/v1/admin/ai/quota', { token: race.adminToken, body: { accountId: race.user.accountId, requestsLimit: 1 } });
    assert.equal(set.status, 200);
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      race.call('POST', '/v1/ai/identify', { token: race.user.token, body: { image: image(), userConsent: true } })));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, ...Array(9).fill(429)]);
    assert.ok(results.filter((r) => r.status === 429).every((r) => r.body.error.code === 'AI_QUOTA_EXHAUSTED'));
  } finally { await race.close(); }
});

test('9. an upstream that hangs for 15 s is abandoned at exactly 12 s with a retryable error', async () => {
  assert.equal(h.app.config.aiTimeoutMs, 12_000);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let aborted = false;
    const hanging = fakeProvider({
      identify: (_image, signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { aborted = true; });
        setTimeout(() => resolve('{"kind":"wildlife","confidence":"low"}'), 15_000);
      }),
    });
    const outcome: { value: unknown } = { value: 'pending' };
    const call = identify(hanging, image(), 12_000).then((v) => { outcome.value = v; }, (e) => { outcome.value = e; });
    mock.timers.tick(11_999);
    await Promise.resolve();
    assert.equal(String(outcome.value), 'pending', 'still waiting just before the deadline');
    mock.timers.tick(1);
    await call;
    const settled = outcome.value;
    assert.ok(settled instanceof ApiError);
    assert.equal((settled as ApiError).code, 'AI_UPSTREAM_TIMEOUT');
    assert.equal((settled as ApiError).retryable, true);
    assert.equal(aborted, true, 'the upstream request is cancelled, not left running');
  } finally { mock.timers.reset(); }
});

test('10. an expired session never revokes Free editing or a valid offline grant', async () => {
  const issued = await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid' } });
  const deviceHash = crypto.createHash('sha256').update('device-a').digest('hex');
  const activated = await h.call('POST', '/v1/licences/activate', { body: { licenceKey: issued.body.licenceKey, deviceHash, platform: 'windows', appVersion: '26.11.2' } });
  assert.equal(activated.status, 200);
  const keys = { [h.app.config.signingKey.keyId]: h.app.config.signingKey.publicKeyBase64 };

  // Twenty days later, offline, with every session long expired: still a paid editor.
  const check = await verifyEntitlementGrant(activated.body.grant, keys, deviceHash);
  assert.equal(check.ok, true);
  const grant = check.ok ? check.grant : null;
  const later = accessCapabilities(snapshotFromGrant(grant, h.clock.now + 20 * 86_400_000, false));
  assert.equal(later.fullEditor, true);
  assert.equal(later.localEditing, true);

  // Past the 30-day window: paid tools pause, local work never does.
  const lapsed = accessCapabilities(snapshotFromGrant(grant, h.clock.now + 31 * 86_400_000, false));
  assert.equal(lapsed.fullEditor, false);
  assert.equal(lapsed.localEditing, true);
  assert.equal(lapsed.localDataExport, true);
  assert.equal(lapsed.localProjectAccess, true);

  // No grant at all, or a grant for another device: Free, never locked.
  const none = accessCapabilities(snapshotFromGrant(null, h.clock.now, false));
  assert.equal(none.localEditing, true);
  assert.deepEqual(await verifyEntitlementGrant(activated.body.grant, keys, 'f'.repeat(64)), { ok: false, reason: 'other_device' });
});

test('11. a model download that does not match the signed manifest is rejected and the old weights stay', async () => {
  const good = Buffer.from('pretend onnx weights v2');
  const sha256 = crypto.createHash('sha256').update(good).digest('hex');
  const register = await h.call('POST', '/v1/admin/models', { token: h.adminToken, body: { id: 'species-model', kind: 'onnx', version: '2026.11.2', path: '/data/models/bioclip-v2.onnx', sha256, bytes: good.length } });
  assert.equal(register.status, 200);
  assert.equal((await h.call('POST', '/v1/admin/models/promote', { token: h.adminToken, body: { id: 'species-model', version: '2026.11.2' } })).status, 200);

  const manifest = await h.call('GET', '/v1/models/manifest?app=26.11.2');
  const keys = { [h.app.config.signingKey.keyId]: h.app.config.signingKey.publicKeyBase64 };
  const opened = await openSignedDataManifest(manifest.body, keys);
  assert.equal(opened.ok, true);
  const asset = opened.ok ? opened.manifest.assets[0] : null;
  assert.ok(asset);

  const previous = { id: 'species-model', version: '2026.11.1', sha256: 'a'.repeat(64) };
  const tampered = new Uint8Array(Buffer.from('pretend onnx weights v3')) as Uint8Array<ArrayBuffer>;
  const decision = await stageDownloadedAsset(asset, tampered, previous);
  assert.deepEqual(decision, { action: 'keep_previous', installed: previous, reason: 'checksum_mismatch' });
  const truncated = await stageDownloadedAsset(asset, new Uint8Array(good.subarray(0, 4)) as Uint8Array<ArrayBuffer>, previous);
  assert.equal(truncated.action, 'keep_previous');
  assert.equal((await stageDownloadedAsset(asset, new Uint8Array(good) as Uint8Array<ArrayBuffer>, previous)).action, 'swap');

  // A manifest edited in transit (someone swaps the checksum) fails its signature.
  const forged = structuredClone(manifest.body);
  forged.payload.assets[0].sha256 = crypto.createHash('sha256').update(tampered).digest('hex');
  assert.deepEqual(await openSignedDataManifest(forged, keys), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(await openSignedDataManifest(manifest.body, { other: h.app.config.signingKey.publicKeyBase64 }), { ok: false, reason: 'unknown_key' });
});

test('12. model ids or paths with "..", absolute paths or drive letters are refused', async () => {
  const sha256 = 'b'.repeat(64);
  for (const [id, path] of [
    ['../../evil', '/data/models/evil.onnx'],
    ['species-model', '/data/../../etc/passwd'],
    ['species-model', '/etc/passwd'],
    ['species-model', 'C:\\Windows\\System32\\evil.onnx'],
    ['species-model', '/data/models//double.onnx'],
    ['species-model', '../data/models/up.onnx'],
  ]) {
    const response = await h.call('POST', '/v1/admin/models', { token: h.adminToken, body: { id, kind: 'onnx', version: '9.9.9', path, sha256, bytes: 10 } });
    assert.equal(response.status, 400, `${id} ${path}`);
    assert.equal(response.body.error.code, 'ASSET_INVALID');
    // The client parser, which runs after signature verification, refuses the same thing.
    assert.equal(parseDataManifest({ schema: 1, revision: 2, assets: [{ id, kind: 'onnx', version: '9.9.9', path, sha256, bytes: 10 }] }), null);
  }
  const denied = (await h.app.store.listAudit(1000)).filter((e) => e.action === 'model.register' && e.outcome === 'denied').length;
  assert.equal(denied, 6);
});

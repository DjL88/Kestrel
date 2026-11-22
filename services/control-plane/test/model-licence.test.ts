import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers.ts';

const licence = { spdx: 'Apache-2.0', sourceUrl: 'https://example.org/model', rightsConfirmed: true };
const onnx = (extra: object = {}) => ({ id: 'denoise-heavy', kind: 'onnx', version: '2026.12.1', path: '/data/onnx/denoise-heavy/2026.12.1/m.onnx', sha256: 'a'.repeat(64), bytes: 120_000_000, contract: 'denoise-heavy/v1', licence, ...extra });

test('an ONNX model needs a contract and a licence record to register; a data file does not', async () => {
  const h = await startHarness();
  try {
    const t = h.adminToken;
    const noLicence = await h.call('POST', '/v1/admin/models', { token: t, body: onnx({ licence: undefined }) });
    assert.equal(noLicence.status, 400); assert.equal(noLicence.body.error.code, 'MODEL_LICENCE_REQUIRED');
    const noContract = await h.call('POST', '/v1/admin/models', { token: t, body: onnx({ contract: undefined }) });
    assert.equal(noContract.status, 400); assert.equal(noContract.body.error.code, 'MODEL_CONTRACT_REQUIRED');
    const unconfirmed = await h.call('POST', '/v1/admin/models', { token: t, body: onnx({ licence: { ...licence, rightsConfirmed: false } }) });
    assert.equal(unconfirmed.status, 400);
    const insecure = await h.call('POST', '/v1/admin/models', { token: t, body: onnx({ licence: { ...licence, sourceUrl: 'http://example.org/m' } }) });
    assert.equal(insecure.status, 400);
    assert.equal((await h.call('POST', '/v1/admin/models', { token: t, body: { id: 'species-library-uk', kind: 'species-library', version: '1.0.0', path: '/data/species/uk.json', sha256: 'c'.repeat(64), bytes: 100 } })).status, 200);
  } finally { await h.close(); }
});

test('a registered model appears in the signed manifest with its contract; the licence record is listed and audited', async () => {
  const h = await startHarness();
  try {
    const t = h.adminToken;
    assert.equal((await h.call('POST', '/v1/admin/models', { token: t, body: onnx() })).status, 200);
    assert.equal((await h.call('POST', '/v1/admin/models/promote', { token: t, body: { id: 'denoise-heavy', version: '2026.12.1' } })).status, 200);
    const m = (await h.call('GET', '/v1/models/manifest?app=26.11.2')).body.payload;
    const a = m.assets.find((x: { id: string }) => x.id === 'denoise-heavy');
    assert.equal(a.contract, 'denoise-heavy/v1'); assert.equal(a.bytes, 120_000_000); assert.equal(a.sha256, 'a'.repeat(64));
    const list = await h.call('GET', '/v1/admin/models/licences', { token: t });
    assert.equal(list.status, 200);
    assert.equal(list.body.licences['denoise-heavy@2026.12.1'].spdx, 'Apache-2.0');
    assert.equal(h.adminToken && (await h.call('GET', '/v1/admin/models/licences', { token: h.user.token })).status, 403);
  } finally { await h.close(); }
});

test('an ONNX version with no licence record cannot be promoted, and cannot be re-registered with a different hash', async () => {
  const h = await startHarness();
  try {
    const t = h.adminToken;
    // Registered before licence records existed: straight into the store.
    await h.app.store.insertModelAsset({ assetId: 'old-model', kind: 'onnx', version: '1', channel: 'stable', path: '/data/onnx/old.onnx', sha256: 'b'.repeat(64), bytes: 10, requiredAppMin: '0.0.0', status: 'candidate', createdAtMs: 1 });
    const p = await h.call('POST', '/v1/admin/models/promote', { token: t, body: { id: 'old-model', version: '1' } });
    assert.equal(p.status, 409); assert.equal(p.body.error.code, 'MODEL_LICENCE_MISSING');
    assert.equal((await h.call('POST', '/v1/admin/models', { token: t, body: onnx() })).status, 200);
    const again = await h.call('POST', '/v1/admin/models', { token: t, body: onnx({ sha256: 'd'.repeat(64) }) });
    assert.equal(again.status, 409, 'a published version is immutable');
  } finally { await h.close(); }
});

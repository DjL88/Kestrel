import assert from 'node:assert/strict';
import test from 'node:test';
import { openEnvelope } from '../../../src/core/signedEnvelope.ts';
import { parseSwitchDoc } from '../../../src/core/featureSwitches.ts';
import { MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { startHarness, type Harness } from './helpers.ts';

const keys = (h: Harness) => ({ [h.app.config.signingKey.keyId]: h.app.config.signingKey.publicKeyBase64 });
const set = (h: Harness, body: unknown, token = h.adminToken) => h.call('POST', '/v1/admin/feature-switches/set', { token, body });
const publicSwitches = async (h: Harness) => {
  const response = await h.call('GET', '/v1/flags/public');
  const opened = await openEnvelope(response.body, keys(h));
  assert.ok(!('failure' in opened));
  return 'failure' in opened ? {} : (opened.payload as { switches: unknown }).switches;
};

test('only the owner can read, change or reset switches; refusals are audited and change nothing', async () => {
  const h = await startHarness();
  try {
    assert.equal((await set(h, { id: 'species-id', scope: 'device', on: true }, h.user.token)).status, 403);
    assert.equal((await h.call('GET', '/v1/admin/feature-switches', { token: h.user.token })).status, 403);
    assert.equal((await h.call('POST', '/v1/admin/feature-switches/reset', { token: h.user.token, body: { id: 'species-id' } })).status, 403);
    assert.equal((await h.call('GET', '/v1/admin/feature-switches')).status, 401);
    assert.deepEqual(await publicSwitches(h), {});
    const audit = JSON.stringify((await h.call('GET', '/v1/admin/audit', { token: h.adminToken })).body);
    assert.ok(audit.includes('feature-switch.set') && audit.includes('not an admin'));
  } finally { await h.close(); }
});

test('every change and reset is audited, defaults come from the licence audit, and the signed list carries explicit choices only', async () => {
  const h = await startHarness();
  try {
    const first = await h.call('GET', '/v1/admin/feature-switches', { token: h.adminToken });
    const byId = (body: { features: Array<{ id: string }> }, id: string) => body.features.find((f) => f.id === id) as never as { device: { on: boolean; default: boolean }; cloud: { applies: boolean }; licence: { verdict: string; reportDate: string }; changedAtMs: number | null; changedBy: string | null };
    const species = byId(first.body, 'species-id');
    assert.deepEqual([species.device.on, species.device.default, species.cloud.applies, species.changedAtMs, species.licence.verdict, species.licence.reportDate], [false, false, false, null, 'red', '2026-11-28'], 'red models are off by default');
    for (const id of ['subject-mask-model', 'fine-edge-mask', 'tap-to-select']) assert.equal(byId(first.body, id).device.on, false, id);
    for (const id of ['learned-denoise', 'category-gate', 'cloud-processing']) assert.equal(byId(first.body, id).device.on, true, id);
    assert.deepEqual(await publicSwitches(h), {}, 'nothing explicit yet: apps use their built-in defaults');

    assert.equal((await set(h, { id: 'species-id', scope: 'device', on: true })).status, 200);
    assert.equal((await set(h, { id: 'cloud-processing', scope: 'cloud', on: false })).status, 200);
    assert.deepEqual(parseSwitchDoc(await publicSwitches(h)), { 'species-id': { device: true }, 'cloud-processing': { cloud: false } });
    const after = await h.call('GET', '/v1/admin/feature-switches', { token: h.adminToken });
    const changed = byId(after.body, 'species-id');
    assert.equal(changed.device.on, true);
    assert.ok(changed.changedBy && (changed.changedAtMs ?? 0) > 0);

    assert.equal((await h.call('POST', '/v1/admin/feature-switches/reset', { token: h.adminToken, body: { id: 'species-id' } })).status, 200);
    assert.deepEqual(parseSwitchDoc(await publicSwitches(h)), { 'cloud-processing': { cloud: false } });
    assert.equal(byId((await h.call('GET', '/v1/admin/feature-switches', { token: h.adminToken })).body, 'species-id').device.on, false, 'reset puts a red model back off');

    const audit = JSON.stringify((await h.call('GET', '/v1/admin/audit', { token: h.adminToken })).body);
    for (const text of ['species-id device on', 'cloud-processing cloud off', 'feature-switch.reset']) assert.ok(audit.includes(text), text);
  } finally { await h.close(); }
});

test('unknown ids, a scope a feature does not use, and malformed bodies are refused', async () => {
  const h = await startHarness();
  try {
    assert.equal((await set(h, { id: 'nope', scope: 'device', on: false })).status, 400);
    assert.equal((await set(h, { id: 'species-id', scope: 'cloud', on: false })).status, 400);
    assert.equal((await set(h, { id: 'species-id', scope: 'device', on: 'no' })).status, 400);
    assert.equal((await h.call('POST', '/v1/admin/feature-switches/reset', { token: h.adminToken, body: { id: 'nope' } })).status, 400);
    assert.deepEqual(await publicSwitches(h), {});
  } finally { await h.close(); }
});

test('the cloud scope is enforced on the server: a switched-off feature refuses new jobs and uploads nothing', async () => {
  const runner = new MemoryCloudRunner();
  const h = await startHarness(undefined, undefined, { cloud: { runner, ledger: new MemoryCloudLedger(), jobsPerPeriod: 5, maxInputBytes: 120_000_000 } });
  try {
    const job = { kind: 'denoise', inputBytes: 1_000_000, userConsent: true };
    assert.equal((await set(h, { id: 'learned-denoise', scope: 'cloud', on: false })).status, 200);
    const refused = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    assert.equal(refused.status, 503); assert.equal(refused.body.error.code, 'CLOUD_DISABLED');
    assert.equal(runner.uploadsCreated, 0);
    // Another kind is unaffected, and the device scope never blocks the server.
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: { ...job, kind: 'upscale' } })).status, 200);
    await h.call('POST', '/v1/admin/feature-switches/reset', { token: h.adminToken, body: { id: 'learned-denoise' } });
    await set(h, { id: 'learned-denoise', scope: 'device', on: false });
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).status, 200);
    // The whole of cloud processing off refuses everything.
    await set(h, { id: 'cloud-processing', scope: 'cloud', on: false });
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: { ...job, kind: 'upscale' } })).status, 503);
  } finally { await h.close(); }
});

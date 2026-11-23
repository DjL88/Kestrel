import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { MemoryLearningSink } from '../src/learningSignal.ts';
import { MemorySafeCopyCatalog, MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { fakeProvider, image, startHarness } from './helpers.ts';

const job = { kind: 'denoise', inputBytes: 1000, userConsent: true };
const sig = { source: 'gemini', capability: 'exposure', action: 'accepted', proposal: { exposure: 0.1 }, final: { exposure: 0.1 }, appVersion: '26.11.2' };
async function prod() {
  const sc = { storage: new MemorySafeCopyStorage(), catalog: new MemorySafeCopyCatalog(), bytesQuota: 1e9 };
  const h = await startHarness(fakeProvider(), undefined, {
    requireAdminSwitch: true, learning: new MemoryLearningSink(), safeCopy: sc,
    cloud: { runner: new MemoryCloudRunner(), ledger: new MemoryCloudLedger(), jobsPerPeriod: 9, maxInputBytes: 1e9 },
  });
  const sw = (key: string, on: boolean) => h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key, on } });
  return { h, sw };
}

test('switches are admin only and list what is configured', async () => {
  const { h } = await prod();
  try {
    assert.equal((await h.call('GET', '/v1/admin/switches')).status, 401);
    assert.equal((await h.call('GET', '/v1/admin/switches', { token: h.user.token })).status, 403);
    const list = (await h.call('GET', '/v1/admin/switches', { token: h.adminToken })).body.switches;
    const by = Object.fromEntries(list.map((s: any) => [s.key, s]));
    assert.deepEqual(Object.keys(by).sort(), ['cloud-processing', 'learning-signal', 'managed-ai', 'safe-copy']);
    assert.equal(by['managed-ai'].on, true, 'the existing Gemini helper keeps working until you switch it off');
    for (const k of ['cloud-processing', 'safe-copy', 'learning-signal']) { assert.equal(by[k].on, false, `${k} starts off`); assert.equal(by[k].configured, true); }
  } finally { await h.close(); }
});

test('cloud processing: off until the admin switches it on, off again at once, and every change is audited', async () => {
  const { h, sw } = await prod();
  try {
    const off = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    assert.equal(off.status, 503); assert.equal(off.body.error.code, 'CLOUD_DISABLED');
    assert.equal((await sw('cloud-processing', true)).status, 200);
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).status, 200);
    assert.equal((await sw('cloud-processing', false)).status, 200);
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).status, 503);
    const audit = JSON.stringify((await h.call('GET', '/v1/admin/audit', { token: h.adminToken })).body);
    assert.ok(audit.includes('switch.set'));
  } finally { await h.close(); }
});

test('managed Gemini: on by default, the admin can switch it off and on', async () => {
  const { h, sw } = await prod();
  try {
    await h.call('POST', '/v1/me/ai-consent', { token: h.user.token, body: { consent: true } });
    const ask = () => h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(), userConsent: true } });
    assert.equal((await ask()).status, 200);
    await sw('managed-ai', false);
    const r = await ask(); assert.equal(r.status, 503); assert.equal(r.body.error.code, 'AI_DISABLED');
    await sw('managed-ai', true); assert.equal((await ask()).status, 200);
  } finally { await h.close(); }
});

test('safe copy off stops uploads only; learning off stops sharing but never blocks opting out and deletion', async () => {
  const { h, sw } = await prod();
  try {
    const id = await h.app.createAccount('c@example.test', 'cloud-password-123', 'user');
    const { newLicence } = await import('../src/store.ts');
    await h.app.store.insertLicence(newLicence('lic-c', 'subscriber', h.clock.now, { accountId: id }));
    const token = (await h.app.issueSession(id, 'user')).accessToken;
    await h.call('POST', '/v1/me/safe-copy', { token, body: { levels: { previews: true } } });
    const up = { level: 'previews', sha256: 'a'.repeat(64), bytes: 1000 };
    let r = await h.call('POST', '/v1/safe-copy/upload-url', { token, body: up });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'SAFE_COPY_DISABLED');
    await sw('safe-copy', true);
    assert.equal((await h.call('POST', '/v1/safe-copy/upload-url', { token, body: up })).status, 200);
    await h.call('POST', '/v1/safe-copy/commit', { token, body: { level: 'previews', sha256: up.sha256 } });
    await sw('safe-copy', false);
    assert.equal((await h.call('POST', '/v1/safe-copy/download-url', { token, body: { level: 'previews', sha256: up.sha256 } })).status, 200, 'reading your own copy never stops');
    // learning
    r = await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'LEARNING_DISABLED');
    await sw('learning-signal', true);
    assert.equal((await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: true } })).status, 200);
    assert.equal((await h.call('POST', '/v1/learning/signals', { token: h.user.token, body: sig })).status, 410, 'the legacy intake is retired whatever the switch says');
    await sw('learning-signal', false);
    assert.equal((await h.call('POST', '/v1/learning/signals', { token: h.user.token, body: sig })).status, 410);
    const out = await h.call('POST', '/v1/me/learning-consent', { token: h.user.token, body: { consent: false } });
    assert.equal(out.status, 200); assert.equal(out.body.deleted, 0, 'opting out still works while the switch is off (nothing is stored by the retired intake)');
  } finally { await h.close(); }
});

test('a feature that is not set up cannot be switched on, and the old kill settings still win', async () => {
  const h = await startHarness(undefined, undefined, { requireAdminSwitch: true });
  try {
    const r = await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'cloud-processing', on: true } });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SWITCH_NOT_CONFIGURED');
    assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'nope', on: true } })).status, 400);
    const list = (await h.call('GET', '/v1/admin/switches', { token: h.adminToken })).body.switches;
    assert.equal(list.find((s: any) => s.key === 'cloud-processing').configured, false);
  } finally { await h.close(); }
  const { h: h2, sw } = await prod();
  try {
    await sw('cloud-processing', true);
    await h2.app.store.setSetting('cloud_disabled', '1');
    assert.equal((await h2.call('POST', '/v1/cloud/jobs', { token: h2.user.token, body: job })).status, 503, 'the legacy kill setting overrides the switch');
  } finally { await h2.close(); }
});

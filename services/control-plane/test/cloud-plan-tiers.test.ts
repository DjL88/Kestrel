import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { CollabStore } from '../src/collaboration.ts';
import { CloudPhotoStore } from '../src/cloudPhotos.ts';
import { FlatAllowance, MemoryUsageMeter } from '../src/usageMeter.ts';
import { MemorySafeCopyStorage } from '../src/safeCopy.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

/** The usage route needs the cloud-photo meter too; the plan fields come from the cloud job settings. */
function usageOptions() {
  const db = new MemoryFirestore();
  return { collab: new CollabStore(db), cloudPhotos: { store: new CloudPhotoStore(db, new MemorySafeCopyStorage()), meter: new MemoryUsageMeter(), allowance: new FlatAllowance(1000), maxProjectBytes: 50_000_000 } };
}

// Owner, 28 Nov 2026: Free has no cloud, Pro (£2.99) 500 a month, Pro Plus (£9.99) 5,000. Tiny numbers here, same shape.
const job = { kind: 'denoise', inputBytes: 30_000_000, userConsent: true };
const cloud = () => ({ runner: new MemoryCloudRunner(), ledger: new MemoryCloudLedger(), jobsPerPeriod: 1, plusJobsPerPeriod: 3, maxInputBytes: 120_000_000 });

test('Free has no cloud at all: refused, nothing uploaded', async () => {
  const c = cloud();
  const h = await startHarness(undefined, undefined, { cloud: { ...c, basicJobsPerPeriod: 0 }, ...usageOptions() });
  try {
    const id = await h.app.createAccount('free@example.test', 'free-password-123', 'user');
    const token = (await h.app.issueSession(id, 'user')).accessToken;
    const r = await h.call('POST', '/v1/cloud/jobs', { token, body: job });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'CLOUD_NOT_ENTITLED');
    assert.equal(c.runner.uploadsCreated, 0);
    const usage = await h.call('GET', '/v1/me/usage', { token });
    assert.equal(usage.body.plan, 'basic'); assert.equal(usage.body.photosIncluded, 0);
  } finally { await h.close(); }
});

test('Pro gets the Pro allowance and Pro Plus the larger one', async () => {
  const pro = await startHarness(undefined, undefined, { cloud: cloud(), ...usageOptions() });
  try {
    assert.equal((await pro.call('GET', '/v1/me/usage', { token: pro.user.token })).body.plan, 'pro');
    assert.equal((await pro.call('GET', '/v1/me/usage', { token: pro.user.token })).body.photosIncluded, 1);
    assert.equal((await pro.call('POST', '/v1/cloud/jobs', { token: pro.user.token, body: job })).status, 200);
    assert.equal((await pro.call('POST', '/v1/cloud/jobs', { token: pro.user.token, body: job })).status, 429, 'Pro is at its allowance');
  } finally { await pro.close(); }
  const plus = await startHarness(undefined, undefined, { cloud: cloud(), ...usageOptions(), appDeps: { hasPlusSubscription: async () => true } });
  try {
    const usage = await plus.call('GET', '/v1/me/usage', { token: plus.user.token });
    assert.equal(usage.body.plan, 'plus'); assert.equal(usage.body.photosIncluded, 3);
    for (let i = 0; i < 3; i += 1) assert.equal((await plus.call('POST', '/v1/cloud/jobs', { token: plus.user.token, body: job })).status, 200);
    assert.equal((await plus.call('POST', '/v1/cloud/jobs', { token: plus.user.token, body: job })).status, 429);
  } finally { await plus.close(); }
});

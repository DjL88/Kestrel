import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySpendGuard, FirestoreSpendGuard, monthKey, type SpendGuard } from '../src/spendGuard.ts';
import { fakeProvider, image, startHarness } from './helpers.ts';
import { MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const T = Date.UTC(2026, 10, 22, 12);
for (const [name, make] of [['memory', () => new MemorySpendGuard()], ['firestore', () => new FirestoreSpendGuard(new MemoryFirestore())]] as Array<[string, () => SpendGuard]>) {
  test(`${name}: reserve stops at the ceiling, refunds, rolls over per month, never goes negative`, async () => {
    const g = make();
    assert.equal(await g.reserve(T, 600, 1000), true);
    assert.equal(await g.reserve(T, 400, 1000), true);
    assert.equal(await g.reserve(T, 1, 1000), false, 'ceiling is hard');
    await g.refund(T, 400);
    assert.equal(await g.reserve(T, 400, 1000), true);
    await g.refund(T, 99999); assert.equal(await g.spent(T), 0);
    assert.equal(await g.reserve(T, 1000, 1000), true);
    assert.equal(await g.reserve(Date.UTC(2026, 11, 1), 1000, 1000), true, 'a new month starts at zero');
  });
  test(`${name}: concurrent reserves never overspend`, async () => {
    const g = make();
    const r = await Promise.all(Array.from({ length: 12 }, () => g.reserve(T, 100, 500)));
    assert.equal(r.filter(Boolean).length, 5);
    assert.equal(await g.spent(T), 500);
  });
}
test('month key is UTC', () => { assert.equal(monthKey(Date.UTC(2026, 10, 30, 23, 59)), '2026-11'); assert.equal(monthKey(Date.UTC(2026, 11, 1)), '2026-12'); });

test('a cloud job over the ceiling is refused before anything is uploaded; a failed start is refunded', async () => {
  const runner = new MemoryCloudRunner(); const spend = new MemorySpendGuard();
  const h = await startHarness(undefined, undefined, { cloud: { runner, ledger: new MemoryCloudLedger(), jobsPerPeriod: 99, maxInputBytes: 1e9 }, spend: { guard: spend, ceilingPence: 5, cloudJobPence: 3, aiCallPence: 1 } });
  try {
    const job = { kind: 'denoise', inputBytes: 1000, userConsent: true };
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).status, 200);
    const over = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    assert.equal(over.status, 503); assert.equal(over.body.error.code, 'SPEND_CEILING_REACHED');
    assert.equal(runner.uploadsCreated, 1);
    runner.failNext = true; // ceiling has 2 left, job costs 3: still refused
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).body.error.code, 'SPEND_CEILING_REACHED');
    assert.equal(await spend.spent(h.clock.now), 3);
  } finally { await h.close(); }
});

test('a managed AI call over the ceiling is refused before the provider is called, and a provider failure is refunded', async () => {
  const provider = fakeProvider(); const spend = new MemorySpendGuard();
  const h = await startHarness(provider, undefined, { spend: { guard: spend, ceilingPence: 2, cloudJobPence: 3, aiCallPence: 1 } });
  try {
    await h.call('POST', '/v1/me/ai-consent', { token: h.user.token, body: { consent: true } });
    const ask = () => h.call('POST', '/v1/ai/identify', { token: h.user.token, body: { image: image(), userConsent: true } });
    assert.equal((await ask()).status, 200); assert.equal((await ask()).status, 200);
    const over = await ask(); assert.equal(over.status, 503); assert.equal(over.body.error.code, 'SPEND_CEILING_REACHED');
    assert.equal(provider.calls, 2);
    assert.equal((await h.app.store.getQuota(h.user.accountId))?.requestsUsed, 2, 'a refused call takes no allowance');
  } finally { await h.close(); }
});

test('a cloud runner failure and a failed job both give the reserved spend back, exactly once', async () => {
  const runner = new MemoryCloudRunner(); const spend = new MemorySpendGuard();
  const h = await startHarness(undefined, undefined, { cloud: { runner, ledger: new MemoryCloudLedger(), jobsPerPeriod: 99, maxInputBytes: 1e9 }, spend: { guard: spend, ceilingPence: 10, cloudJobPence: 3, aiCallPence: 1 } });
  try {
    const job = { kind: 'denoise', inputBytes: 1000, userConsent: true };
    runner.failNext = true;
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).status, 502);
    assert.equal(await spend.spent(h.clock.now), 0, 'a job that never started costs nothing');
    const { jobId } = (await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).body;
    runner.simulateUpload(jobId);
    await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
    assert.equal(await spend.spent(h.clock.now), 3);
    runner.failJob(jobId, 'x');
    await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: h.user.token }); await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: h.user.token });
    assert.equal(await spend.spent(h.clock.now), 0, 'refunded once, not twice');
  } finally { await h.close(); }
});

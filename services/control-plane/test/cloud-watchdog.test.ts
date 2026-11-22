import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { MemorySpendGuard } from '../src/spendGuard.ts';
import { startHarness } from './helpers.ts';

const MIN = 60_000;
async function harness() {
  const runner = new MemoryCloudRunner(); const ledger = new MemoryCloudLedger(); const spend = new MemorySpendGuard();
  const h = await startHarness(undefined, undefined, { cloud: { runner, ledger, jobsPerPeriod: 5, maxInputBytes: 1e9, maxJobMs: 30 * MIN }, spend: { guard: spend, ceilingPence: 100, cloudJobPence: 3, aiCallPence: 1 } });
  return { h, runner, ledger, spend };
}
const create = (h: any) => h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: { kind: 'denoise', inputBytes: 1000, userConsent: true } });
const fresh = (h: any) => h.app.issueSession(h.user.accountId, 'user').then((s: any) => s.accessToken);

test('a job still running past the maximum time is failed, its input deleted, quota and spend refunded exactly once', async () => {
  const { h, runner, ledger, spend } = await harness();
  try {
    const { jobId } = (await create(h)).body;
    runner.simulateUpload(jobId);
    await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
    assert.equal(ledger.used(h.user.accountId), 1); assert.equal(await spend.spent(h.clock.now), 3);
    h.clock.now += 10 * MIN;
    let st = await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: await fresh(h) });
    assert.equal(st.body.status, 'running', 'still inside the limit');
    h.clock.now += 25 * MIN;
    const token = await fresh(h);
    st = await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token });
    await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token });
    assert.equal(st.body.status, 'failed'); assert.equal(st.body.failure, 'CLOUD_JOB_FAILED');
    assert.equal(runner.hasInput(jobId), false);
    assert.equal(ledger.used(h.user.accountId), 0, 'quota refunded once');
    assert.equal(await spend.spent(h.clock.now), 0, 'spend refunded once');
  } finally { await h.close(); }
});

test('a job that finishes in time is not touched by the watchdog', async () => {
  const { h, runner, spend } = await harness();
  try {
    const { jobId } = (await create(h)).body;
    runner.simulateUpload(jobId);
    await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
    runner.completeJob(jobId);
    h.clock.now += 29 * MIN;
    const st = await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: await fresh(h) });
    assert.equal(st.body.status, 'ready');
    assert.equal(await spend.spent(h.clock.now), 3, 'a completed job keeps its cost');
  } finally { await h.close(); }
});

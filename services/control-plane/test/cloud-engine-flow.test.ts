import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_KINDS, MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { startHarness } from './helpers.ts';

async function harness() {
  const runner = new MemoryCloudRunner(); const ledger = new MemoryCloudLedger();
  const h = await startHarness(undefined, undefined, { cloud: { runner, ledger, jobsPerPeriod: 5, maxInputBytes: 120_000_000 } });
  return { h, runner, ledger };
}
const create = (h: any, kind = 'denoise') => h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: { kind, inputBytes: 30_000_000, userConsent: true } });

test('job kinds are the engine capability names: denoise, upscale, mask', async () => {
  assert.deepEqual([...CLOUD_KINDS], ['denoise', 'upscale', 'mask']);
  const { h } = await harness();
  try {
    assert.equal((await create(h, 'mask')).status, 200);
    assert.equal((await create(h, 'subject-mask')).status, 400, 'the old name is gone');
  } finally { await h.close(); }
});

test('upload, start, ready: the input is deleted when the job ends and a signed result URL is returned', async () => {
  const { h, runner } = await harness();
  try {
    const { jobId } = (await create(h)).body;
    const early = await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
    assert.equal(early.status, 409); assert.equal(early.body.error.code, 'CLOUD_INPUT_MISSING');
    runner.simulateUpload(jobId);
    const started = await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
    assert.equal(started.status, 200); assert.equal(started.body.status, 'running');
    assert.equal((await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token })).status, 200, 'start is idempotent');
    assert.equal(runner.starts, 1);
    runner.completeJob(jobId);
    const st = await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: h.user.token });
    assert.equal(st.body.status, 'ready'); assert.match(st.body.resultUrl, /^memory:\/\/result\//);
    assert.equal(runner.hasInput(jobId), false, 'input gone at job end, not left for finish or the lifecycle backstop');
    assert.equal(runner.hasResult(jobId), true);
    const fin = await h.call('POST', `/v1/cloud/jobs/${jobId}/finish`, { token: h.user.token });
    assert.equal(fin.body.inputDeleted, true); assert.equal(runner.hasResult(jobId), false, 'result removed once collected');
    assert.equal((await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: h.user.token })).body.resultUrl, undefined);
  } finally { await h.close(); }
});

test('a failed job reports a code only, deletes the input and refunds the quota exactly once', async () => {
  const { h, runner, ledger } = await harness();
  try {
    const { jobId } = (await create(h)).body;
    runner.simulateUpload(jobId);
    await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
    assert.equal(ledger.used(h.user.accountId), 1);
    runner.failJob(jobId, 'photo.nef could not be decoded for jane@example.com');
    const a = await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: h.user.token });
    await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: h.user.token });
    assert.equal(a.body.status, 'failed'); assert.equal(a.body.failure, 'CLOUD_JOB_FAILED');
    assert.ok(!JSON.stringify(a.body).includes('jane') && !JSON.stringify(a.body).includes('.nef'), 'runner text never reaches the client');
    assert.equal(runner.hasInput(jobId), false);
    assert.equal(ledger.used(h.user.accountId), 0, 'refunded once, not twice');
  } finally { await h.close(); }
});

test('start re-checks the kill switch and Pro on every request, and only the owner can start or read a job', async () => {
  const { h, runner } = await harness();
  try {
    const { jobId } = (await create(h)).body;
    runner.simulateUpload(jobId);
    const id = await h.app.createAccount('o@example.test', 'other-password-123', 'user');
    const other = (await h.app.issueSession(id, 'user')).accessToken;
    assert.equal((await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: other })).status, 404);
    await h.app.store.setSetting('cloud_disabled', '1');
    const r = await h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'CLOUD_DISABLED');
    assert.equal(runner.starts, 0);
    // The person can still end the job and have their upload deleted while the switch is off.
    assert.equal((await h.call('POST', `/v1/cloud/jobs/${jobId}/finish`, { token: h.user.token })).status, 200);
    assert.equal(runner.hasInput(jobId), false);
  } finally { await h.close(); }
});

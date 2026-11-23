import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_KINDS, MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { MemorySpendGuard } from '../src/spendGuard.ts';
import { startHarness, type Harness } from './helpers.ts';

async function harness() {
  const runner = new MemoryCloudRunner(); const ledger = new MemoryCloudLedger();
  const spend = new MemorySpendGuard();
  const h = await startHarness(undefined, undefined, {
    cloud: { runner, ledger, jobsPerPeriod: 5, maxInputBytes: 120_000_000 },
    spend: { guard: spend, ceilingPence: 100, cloudJobPence: 3, aiCallPence: 1 },
  });
  return { h, runner, ledger, spend };
}
const create = (h: Harness, kind = 'denoise', token = h.user.token) =>
  h.call('POST', '/v1/cloud/jobs', { token, body: { kind, inputBytes: 30_000_000, userConsent: true } });

function checkpoint() {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => { release = resolve; });
  return { reached, release };
}

test('concurrent start requests submit only one Cloud Run execution', { timeout: 5_000 }, async (t) => {
  const { h, runner } = await harness();
  t.after(() => h.close());
  const { jobId } = (await create(h)).body;
  runner.simulateUpload(jobId);
  const bothChecking = checkpoint();
  const inputPresent = runner.inputPresent.bind(runner);
  let checks = 0;
  runner.inputPresent = async (id) => {
    if (++checks === 2) bothChecking.release();
    await bothChecking.reached;
    return inputPresent(id);
  };

  const start = () => h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
  const responses = await Promise.all([start(), start()]);
  assert.deepEqual(responses.map((r) => [r.status, r.body.status]), [[200, 'running'], [200, 'running']]);
  assert.equal(runner.starts, 1);
});

test('losing the dispatch acknowledgement does not let a retry submit another execution', async (t) => {
  const { h, runner } = await harness();
  t.after(() => h.close());
  const { jobId } = (await create(h)).body;
  runner.simulateUpload(jobId);
  const submit = runner.start.bind(runner);
  runner.start = async (id) => {
    await submit(id);
    throw new Error('Connection closed before the response arrived');
  };

  const start = () => h.call('POST', `/v1/cloud/jobs/${jobId}/start`, { token: h.user.token });
  assert.equal((await start()).status, 502);
  assert.equal((await start()).body.status, 'running');
  assert.equal(runner.starts, 1);
});

test('concurrent failure polls cannot refund another job or the next month', { timeout: 5_000 }, async (t) => {
  const { h, runner, ledger, spend } = await harness();
  t.after(() => h.close());
  const november = Date.UTC(2026, 10, 30, 23, 59);
  h.clock.now = november;
  const token = (await h.app.issueSession(h.user.accountId, 'user')).accessToken;
  const call = (method: 'GET' | 'POST', path: string) => h.call(method, path, { token });
  const { jobId } = (await create(h, 'denoise', token)).body;
  const path = `/v1/cloud/jobs/${jobId}`;
  runner.simulateUpload(jobId);
  assert.equal((await call('POST', `${path}/start`)).status, 200);
  runner.failJob(jobId, 'runner failure');

  h.clock.now += 2 * 60_000;
  assert.equal((await create(h, 'denoise', token)).status, 200);
  const bothPolling = checkpoint();
  const poll = runner.poll.bind(runner);
  let polls = 0;
  runner.poll = async (id) => {
    if (++polls === 2) bothPolling.release();
    await bothPolling.reached;
    return poll(id);
  };

  const results = await Promise.all([call('GET', path), call('GET', path)]);
  assert.deepEqual(results.map((r) => r.body.status), ['failed', 'failed']);
  assert.equal(ledger.used(h.user.accountId), 1);
  assert.equal(await spend.spent(november), 0);
  assert.equal(await spend.spent(h.clock.now), 3);
});

test('a poll with a stale runner result cannot reopen a finished job', { timeout: 5_000 }, async (t) => {
  const { h, runner, ledger } = await harness();
  const resultRead = checkpoint();
  const finishComplete = checkpoint();
  t.after(() => { finishComplete.release(); return h.close(); });
  const { jobId } = (await create(h)).body;
  const path = `/v1/cloud/jobs/${jobId}`;
  runner.simulateUpload(jobId);
  assert.equal((await h.call('POST', `${path}/start`, { token: h.user.token })).status, 200);
  runner.completeJob(jobId);
  const poll = runner.poll.bind(runner);
  runner.poll = async (id) => {
    const stale = await poll(id);
    resultRead.release();
    await finishComplete.reached;
    return stale;
  };

  const pending = h.call('GET', path, { token: h.user.token });
  await resultRead.reached;
  const finished = await h.call('POST', `${path}/finish`, { token: h.user.token });
  finishComplete.release();
  assert.equal(finished.status, 200);
  const status = await pending;
  assert.equal(status.body.status, 'finished');
  assert.equal(status.body.resultUrl, undefined);
  assert.equal(ledger.record(jobId)?.status, 'finished');
});

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

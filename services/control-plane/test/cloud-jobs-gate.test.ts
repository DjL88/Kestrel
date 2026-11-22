import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { startHarness } from './helpers.ts';

const job = { kind: 'denoise', inputBytes: 30_000_000, userConsent: true };

async function harness(limit = 2) {
  const runner = new MemoryCloudRunner();
  const ledger = new MemoryCloudLedger();
  const h = await startHarness(undefined, undefined, { cloud: { runner, ledger, jobsPerPeriod: limit, maxInputBytes: 120_000_000 } });
  return { h, runner, ledger };
}

test('unauthenticated, unconsented, oversized and malformed requests never reach the runner or quota', async () => {
  const { h, runner } = await harness();
  try {
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { body: job })).status, 401);
    const noConsent = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: { ...job, userConsent: false } });
    assert.equal(noConsent.status, 400); assert.equal(noConsent.body.error.code, 'CONSENT_REQUIRED');
    const big = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: { ...job, inputBytes: 500_000_000 } });
    assert.equal(big.status, 413); assert.equal(big.body.error.code, 'CLOUD_INPUT_TOO_LARGE');
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: { ...job, kind: 'rm -rf' } })).status, 400);
    assert.equal(runner.uploadsCreated, 0);
  } finally { await h.close(); }
});

test('Pro only: an account without an active paid licence is refused', async () => {
  const { h, runner } = await harness();
  try {
    const id = await h.app.createAccount('free@example.test', 'free-password-123', 'user');
    const token = (await h.app.issueSession(id, 'user')).accessToken;
    const r = await h.call('POST', '/v1/cloud/jobs', { token, body: job });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'CLOUD_NOT_ENTITLED');
    assert.equal(runner.uploadsCreated, 0);
  } finally { await h.close(); }
});

test('kill switch (setting or flag) refuses every request and consumes no quota', async () => {
  const { h, runner, ledger } = await harness();
  try {
    await h.app.store.setSetting('cloud_disabled', '1');
    let r = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'CLOUD_DISABLED');
    await h.app.store.setSetting('cloud_disabled', '0');
    await h.call('POST', '/v1/admin/flags/set', { token: h.adminToken, body: { key: 'cloud.processing', flag: { default: true, kill: true, rules: [] } } });
    r = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'CLOUD_DISABLED');
    assert.equal(runner.uploadsCreated, 0); assert.equal(ledger.used(h.user.accountId), 0);
  } finally { await h.close(); }
});

test('per-account quota is enforced, a runner failure is refunded, and other accounts are unaffected', async () => {
  const { h, runner, ledger } = await harness(2);
  try {
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).status, 200);
    runner.failNext = true;
    const failed = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    assert.equal(failed.status >= 500, true);
    assert.equal(ledger.used(h.user.accountId), 1, 'failed start is refunded');
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job })).status, 200);
    const over = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    assert.equal(over.status, 429); assert.equal(over.body.error.code, 'CLOUD_QUOTA_EXHAUSTED');
    h.clock.now += 31 * 24 * 3600 * 1000;
    const fresh = (await h.app.issueSession(h.user.accountId, 'user')).accessToken; // the old session has expired too
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: fresh, body: job })).status, 200, 'new period');
  } finally { await h.close(); }
});

test('not configured: the deployed service answers 503 and nothing is uploaded', async () => {
  const h = await startHarness();
  try {
    const r = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'CLOUD_NOT_CONFIGURED');
  } finally { await h.close(); }
});

test('finish deletes the input, only the owner may touch a job, and nothing but ids is stored', async () => {
  const { h, runner, ledger } = await harness(5);
  try {
    const made = await h.call('POST', '/v1/cloud/jobs', { token: h.user.token, body: job });
    const { jobId, uploadUrl } = made.body;
    assert.match(uploadUrl, /^memory:\/\//);
    assert.equal(runner.hasInput(jobId), true);
    const otherId = await h.app.createAccount('o@example.test', 'other-password-123', 'user');
    const otherToken = (await h.app.issueSession(otherId, 'user')).accessToken;
    assert.equal((await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: otherToken })).status, 404);
    assert.equal((await h.call('POST', `/v1/cloud/jobs/${jobId}/finish`, { token: otherToken })).status, 404);
    assert.equal(runner.hasInput(jobId), true);
    assert.equal((await h.call('GET', `/v1/cloud/jobs/${jobId}`, { token: h.user.token })).body.status, 'awaiting-upload');
    const fin = await h.call('POST', `/v1/cloud/jobs/${jobId}/finish`, { token: h.user.token });
    assert.equal(fin.status, 200); assert.equal(fin.body.inputDeleted, true);
    assert.equal(runner.hasInput(jobId), false);
    assert.equal((await h.call('POST', `/v1/cloud/jobs/${jobId}/finish`, { token: h.user.token })).status, 200, 'idempotent');
    assert.deepEqual(Object.keys(ledger.record(jobId)!).sort(), ['accountId', 'consentAtMs', 'createdAtMs', 'inputBytes', 'jobId', 'kind', 'status']);
  } finally { await h.close(); }
});

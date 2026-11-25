import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreCloudBalance, MemoryCloudBalance, type CloudBalance } from '../src/cloudBalance.ts';
import { MemoryCloudLedger, MemoryCloudRunner } from '../src/cloudJobs.ts';
import { BalanceBackedMeter, MemoryUsageMeter, millicreditsForBytes } from '../src/usageMeter.ts';
import { MemoryFirestore } from './memoryFirestore.ts';
import { startHarness } from './helpers.ts';

const job = { kind: 'denoise', inputBytes: 30_000_000, userConsent: true };

for (const [name, make] of [['memory', () => new MemoryCloudBalance()], ['firestore', () => new FirestoreCloudBalance(new MemoryFirestore())]] as const) {
  test(`${name} balance: credits and debits apply once per key and never go below zero`, async () => {
    const b: CloudBalance = make();
    await b.credit('a', 500_000, 'topup:1');
    await b.credit('a', 500_000, 'topup:1'); // a retried webhook
    assert.equal(await b.millicredits('a'), 500_000);
    assert.equal(await b.debit('a', 300, 'job:1'), true);
    assert.equal(await b.debit('a', 300, 'job:1'), true, 'a retry is not charged twice');
    assert.equal(await b.millicredits('a'), 499_700);
    assert.equal(await b.debit('a', 1_000_000, 'job:2'), false);
    assert.equal(await b.millicredits('a'), 499_700);
    assert.equal(await b.millicredits('nobody'), 0);
  });
}

test('downloads beyond the free allowance are paid from the balance, and refused when it is empty', async () => {
  const balance = new MemoryCloudBalance();
  let n = 0;
  const meter = new BalanceBackedMeter(new MemoryUsageMeter(), balance, () => String(++n));
  const free = millicreditsForBytes(1e9); // 1 GB = 33 credits
  assert.equal(free, 33_000);
  assert.equal(await meter.reserve('a', 0, 1e9, free), true, 'the free GB');
  assert.equal(await meter.reserve('a', 0, 1e8, free), false, 'nothing left and no balance');
  await balance.credit('a', 10_000, 'topup:1');
  assert.equal(await meter.reserve('a', 0, 1e8, free), true, '100 MB = 3.3 credits from the balance');
  assert.equal(await balance.millicredits('a'), 10_000 - 3_300);
  assert.equal((await meter.usage('a', 0)).bytes, 1.1e9);
});

async function harness(extra: { basic?: number; balance?: CloudBalance } = {}) {
  const runner = new MemoryCloudRunner();
  const ledger = new MemoryCloudLedger();
  const balance = extra.balance ?? new MemoryCloudBalance();
  const h = await startHarness(undefined, undefined, {
    cloud: { runner, ledger, jobsPerPeriod: 2, basicJobsPerPeriod: extra.basic ?? 1, balance, extraPhotoMillicredits: 300, maxInputBytes: 120_000_000 },
    cloudBalance: balance,
  });
  return { h, runner, ledger, balance };
}

test('Basic accounts get their own cloud photo allowance', async () => {
  const { h } = await harness({ basic: 1 });
  try {
    const id = await h.app.createAccount('free@example.test', 'free-password-123', 'user');
    const token = (await h.app.issueSession(id, 'user')).accessToken;
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token, body: job })).status, 200);
    const over = await h.call('POST', '/v1/cloud/jobs', { token, body: job });
    assert.equal(over.status, 429); assert.equal(over.body.error.code, 'CLOUD_QUOTA_EXHAUSTED');
  } finally { await h.close(); }
});

test('beyond the allowance each photo costs 0.3p from the balance; a job that cannot start is paid back', async () => {
  const { h, runner, ledger, balance } = await harness();
  try {
    const t = h.user.token, acc = h.user.accountId;
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: t, body: job })).status, 200);
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: t, body: job })).status, 200);
    assert.equal((await h.call('POST', '/v1/cloud/jobs', { token: t, body: job })).status, 429, 'Pro allowance (2) used, no balance');
    const grant = await h.call('POST', '/v1/admin/cloud-balance', { token: h.adminToken, body: { accountId: acc, credits: 1, reference: 'test-1' } });
    assert.equal(grant.status, 200); assert.equal(grant.body.balanceCredits, 1);
    assert.equal((await h.call('POST', '/v1/admin/cloud-balance', { token: h.adminToken, body: { accountId: acc, credits: 1, reference: 'test-1' } })).body.balanceCredits, 1, 'same reference applies once');
    const paid = await h.call('POST', '/v1/cloud/jobs', { token: t, body: job });
    assert.equal(paid.status, 200);
    assert.equal(await balance.millicredits(acc), 700);
    assert.equal(ledger.record(paid.body.jobId)?.paidMillicredits, 300);
    runner.failNext = true;
    assert.ok((await h.call('POST', '/v1/cloud/jobs', { token: t, body: job })).status >= 500);
    assert.equal(await balance.millicredits(acc), 700, 'the failed start was paid back');
    assert.equal((await h.call('POST', '/v1/admin/cloud-balance', { token: t, body: { accountId: acc, credits: 5, reference: 'x' } })).status, 403);
  } finally { await h.close(); }
});

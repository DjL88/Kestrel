/**
 * Admin Accounts page backend: admin-only, read-only, one month of Paddle payout figures and the cost model's estimate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySpendGuard } from '../src/spendGuard.ts';
import { startHarness } from './helpers.ts';

const sale = (invoiceNumber: string, supplyDate: string, extra: Record<string, unknown> = {}) => ({
  checkoutReference: 'kp_' + invoiceNumber, invoiceNumber, paidAt: supplyDate + 'T12:00:00Z', supplyDate, status: 'paid', country: 'GB',
  currency: 'GBP', totalPence: 2478, netPence: 2478, taxPence: 0, accountId: 'acct_secret', store: 'paddle', storeFeeMinor: 195,
  buyer: { country: 'DE', currency: 'EUR', totalMinor: 3451, taxMinor: 551 }, emailHash: 'not shown', ...extra,
});

test('accounts are admin-only, validate the month, and show only that month with the cost model estimate', async () => {
  const guard = new MemorySpendGuard();
  await guard.reserve(Date.UTC(2026, 10, 5), 340, 1500);
  await guard.reserve(Date.UTC(2026, 9, 5), 999, 1500);
  const rows = [sale('KP-1', '2026-11-03'), sale('KP-2', '2026-10-30'), sale('KP-3', '2026-11-30')];
  const h = await startHarness(undefined, undefined, {
    payments: { listTransactions: async () => rows as never },
    spend: { guard, ceilingPence: 1500, cloudJobPence: 2, aiCallPence: 1 },
  });
  try {
    assert.equal((await h.call('GET', '/v1/admin/accounts')).status, 401);
    assert.equal((await h.call('GET', '/v1/admin/accounts', { token: h.user.token })).status, 403);
    assert.equal((await h.call('GET', '/v1/admin/accounts?month=2026-13', { token: h.adminToken })).status, 400);
    assert.equal((await h.call('POST', '/v1/admin/accounts', { token: h.adminToken, body: {} })).status === 200, false, 'read-only');

    const r = await h.call('GET', '/v1/admin/accounts?month=2026-11', { token: h.adminToken });
    assert.equal(r.status, 200);
    assert.equal(r.body.paymentsConnected, true);
    assert.deepEqual(r.body.transactions.map((t: { invoiceNumber: string }) => t.invoiceNumber), ['KP-1', 'KP-3']);
    assert.equal(r.body.transactions[0].storeFeeMinor, 195);
    assert.equal(r.body.transactions[0].accountId, undefined, 'no account ids on the accounts page');
    assert.equal(r.body.transactions[0].emailHash, undefined);
    assert.deepEqual(r.body.costModel, { reservedPence: 340, ceilingPence: 1500 });

    const october = await h.call('GET', '/v1/admin/accounts?month=2026-10', { token: h.adminToken });
    assert.equal(october.body.transactions.length, 1);
    assert.equal(october.body.costModel.reservedPence, 999);

    const current = await h.call('GET', '/v1/admin/accounts', { token: h.adminToken });
    assert.equal(current.body.month, '2026-11', 'defaults to the current month');
  } finally { await h.close(); }
});

test('accounts use the ledger month query when there is one, and say when Paddle is not connected', async () => {
  let asked = '';
  const h = await startHarness(undefined, undefined, {
    payments: { listTransactions: async () => { throw new Error('should use the month query'); }, listTransactionsForMonth: async (m) => { asked = m; return []; } },
  });
  try {
    const r = await h.call('GET', '/v1/admin/accounts?month=2026-12', { token: h.adminToken });
    assert.equal(r.status, 200);
    assert.equal(asked, '2026-12');
    assert.equal(r.body.costModel, null);
  } finally { await h.close(); }
  const none = await startHarness();
  try {
    const r = await none.call('GET', '/v1/admin/accounts?month=2026-11', { token: none.adminToken });
    assert.equal(r.body.paymentsConnected, false);
    assert.deepEqual(r.body.transactions, []);
  } finally { await none.close(); }
});

test('the ledger month query covers the whole month by supply date, including December into January', async () => {
  const { monthBounds } = await import('../src/commerce/ledger.ts');
  assert.deepEqual(monthBounds('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
  assert.deepEqual(monthBounds('2026-09'), { start: '2026-09-01', end: '2026-10-01' });
  assert.ok('2026-11-30' < monthBounds('2026-11').end && '2026-12-01' >= monthBounds('2026-11').end);
});

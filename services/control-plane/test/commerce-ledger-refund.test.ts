import assert from 'node:assert/strict';
import test from 'node:test';
import { CommerceLedger, countsAsUkTurnover } from '../src/commerce/ledger.ts';
import { commerceCollections, type TransactionRecord } from '../src/commerce/records.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const sale = (reference: string): TransactionRecord => ({
  currency: 'GBP', country: 'GB', jurisdiction: 'GB', customerType: 'B2B', treatment: 'merchant-of-record', rateBasisPoints: 0,
  netPence: 2750, taxPence: 0, totalPence: 2750, vatNumber: null, invoiceNotice: null, verification: null, evidence: [], store: 'paddle',
  checkoutReference: reference, providerCheckoutId: 'txn_01ledgertest0001', providerTransactionId: 'txn_01ledgertest0001', accountId: 'acc_1',
  status: 'paid', supplyDate: '2026-11-28', paidAt: '2026-11-28T12:00:00.000Z', retainThrough: '2036-12-31', invoiceNumber: 'INF-1',
} as TransactionRecord);

test('a refund marks the recorded sale; a full refund is never undone by a later partial one; an unrecorded sale is left alone', async () => {
  const db = new MemoryFirestore();
  const ledger = new CommerceLedger(db as never);
  const status = () => (db.peek(commerceCollections.transactions, 'paddle_ref1') as TransactionRecord | undefined)?.status;
  await ledger.recordPaid(sale('paddle_ref1'));
  assert.equal(await ledger.markRefunded('paddle_ref1', 'partially-refunded'), true);
  assert.equal(status(), 'partially-refunded');
  assert.equal(await ledger.markRefunded('paddle_ref1', 'refunded'), true);
  assert.equal(status(), 'refunded');
  assert.equal(await ledger.markRefunded('paddle_ref1', 'partially-refunded'), true);
  assert.equal(status(), 'refunded', 'a full refund stays a full refund');
  assert.equal(await ledger.markRefunded('paddle_missing', 'refunded'), false);
  await assert.rejects(ledger.markRefunded('bad ref!', 'refunded'));
});

test('UK turnover leaves out fully refunded sales and keeps partly refunded ones in full', () => {
  assert.equal(countsAsUkTurnover({ country: 'GB', currency: 'GBP', status: 'paid' }), true);
  assert.equal(countsAsUkTurnover({ country: 'GB', currency: 'GBP', status: 'partially-refunded' }), true);
  assert.equal(countsAsUkTurnover({ country: 'GB', currency: 'GBP', status: 'refunded' }), false);
  assert.equal(countsAsUkTurnover({ country: 'FR', currency: 'EUR', status: 'paid' }), false);
});

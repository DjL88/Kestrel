import assert from 'node:assert/strict';
import test from 'node:test';
import { sumupProSettlement, type ProPurchaseOrder } from '../src/commerce/proSettlement.ts';
import type { TransactionRecord } from '../src/commerce/records.ts';
import { quoteProTax } from '../src/commerce/tax.ts';
import { emailHashOf } from '../src/entitlement.ts';
import { newLicence } from '../src/store.ts';
import { startHarness } from './helpers.ts';

test('an authenticated Pro grant follows a recorded and verified payment, once', async () => {
  let settle: (id: string) => Promise<void> = async () => {};
  const harness = await startHarness(null, undefined, { settleSumupPro: (id) => settle(id) });
  try {
    const email = 'buyer@example.test';
    const accountId = await harness.app.createAccount(email, 'test-password-with-length', 'user');
    const token = (await harness.app.issueSession(accountId, 'user')).accessToken;
    const paidAt = new Date(harness.clock.now).toISOString();
    const order: ProPurchaseOrder = {
      reference: 'checkout-inflight-test', accountId, emailHash: emailHashOf(email), majorVersion: 1, invoiceNumber: 'TEST-1',
      quote: quoteProTax({ country: 'GB', evidence: [
        { source: 'billing-address', country: 'GB', observedAt: paidAt },
        { source: 'ip-geolocation', country: 'GB', observedAt: paidAt },
      ] }, { ukVatRegistered: false, b2cPricing: 'inclusive', localTaxes: {} }),
    };
    let verified = false;
    let verificationCalls = 0;
    let breakGrantOnce = true;
    const ledger = new Map<string, TransactionRecord>();
    settle = sumupProSettlement({
      findOrder: async (id) => id === 'current-checkout' ? order : null,
      checkouts: { verifyPayment: async ({ reference, totalPence }, checkoutId) => {
        verificationCalls++;
        assert.equal(reference, order.reference);
        assert.equal(totalPence, 2900);
        return verified ? { checkoutId, transactionId: 'provider-payment', paidAt } : null;
      } },
      commerce: { recordPaid: async (record) => {
        if (!ledger.has(record.checkoutReference)) ledger.set(record.checkoutReference, record);
        return ledger.get(record.checkoutReference)!;
      } },
      licences: {
        getAccount: (id) => harness.app.store.getAccount(id),
        grantLicence: (record) => {
          if (breakGrantOnce) {
            breakGrantOnce = false;
            throw new Error('Temporary database error');
          }
          return harness.app.store.grantLicence(record);
        },
      },
    });
    const event = (id: string) => harness.call('POST', '/v1/billing/sumup', { body: { event_type: 'CHECKOUT_STATUS_CHANGED', id, status: 'PAID' } });
    const activate = () => harness.call('POST', '/v1/me/activate', { token, body: { deviceHash: 'a'.repeat(64), platform: 'web', appVersion: '1.0.0' } });
    assert.equal((await event('unknown-checkout')).status, 204);
    assert.equal(verificationCalls, 0);
    assert.equal((await event('current-checkout')).status, 204);
    assert.equal(ledger.size, 0);
    assert.equal((await activate()).status, 403);
    verified = true;
    assert.equal((await event('current-checkout')).status, 503);
    assert.equal(ledger.size, 1);
    assert.equal((await activate()).status, 403);
    assert.equal((await event('current-checkout')).status, 204);
    assert.equal((await event('current-checkout')).status, 204);
    assert.equal(ledger.size, 1);
    const licences = await harness.app.store.listLicencesForAccount(accountId);
    assert.equal(licences.length, 1);
    assert.equal(licences[0].paid, true);
    const activated = await activate();
    assert.equal(activated.status, 200);
    assert.equal(activated.body.grant.payload.offlineUntilMs, harness.clock.now + 30 * 86_400_000);
  } finally {
    await harness.close();
  }
});

test('a monthly account grant cannot outlive its paid-through date', async () => {
  const harness = await startHarness(null);
  try {
    const accountId = await harness.app.createAccount('storage@example.test', 'test-password-with-length', 'user');
    const token = (await harness.app.issueSession(accountId, 'user')).accessToken;
    const validUntilMs = harness.clock.now + 4 * 86_400_000;
    await harness.app.store.insertLicence(newLicence('monthly-storage-test', 'subscriber', harness.clock.now, { accountId, validUntilMs }));
    const response = await harness.call('POST', '/v1/me/activate', {
      token, body: { deviceHash: 'b'.repeat(64), platform: 'web', appVersion: '1.0.0' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.grant.payload.offlineUntilMs, validUntilMs);
  } finally {
    await harness.close();
  }
});

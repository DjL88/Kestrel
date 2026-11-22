import assert from 'node:assert/strict';
import test from 'node:test';
import { sumupCheckouts } from '../src/commerce/sumup.ts';

const credentials = { apiKey: 'test-only-key', merchantCode: 'TESTMERCHANT' };
const order = { reference: 'kestrel-pro-test', totalPence: 3451 };
const checkout = {
  id: 'provider-checkout', checkout_reference: order.reference, amount: 34.51, currency: 'GBP',
  merchant_code: credentials.merchantCode, status: 'PENDING',
  hosted_checkout_url: 'https://checkout.sumup.com/example',
};

test('creates a GBP hosted checkout from the server total', async () => {
  const adapter = sumupCheckouts(credentials, async (url, request) => {
    assert.equal(url, 'https://api.sumup.com/v0.1/checkouts');
    assert.equal(request?.method, 'POST');
    assert.equal(new Headers(request?.headers).get('Authorization'), 'Bearer test-only-key');
    const payload = JSON.parse(String(request?.body));
    assert.equal(payload.amount, 34.51);
    assert.equal(payload.redirect_url, 'https://example.com/complete');
    assert.equal(payload.return_url, 'https://example.com/v1/billing/sumup');
    assert.deepEqual(payload.hosted_checkout, { enabled: true });
    return Response.json(checkout);
  });
  assert.deepEqual(await adapter.create(order, 'https://example.com/complete', 'https://example.com/v1/billing/sumup'), {
    checkoutId: checkout.id, url: checkout.hosted_checkout_url,
  });
});

test('a successful payment must be confirmed by both the checkout and the transaction', async () => {
  const calls: string[] = [];
  const successful = {
    id: 'provider-payment', status: 'SUCCESSFUL', amount: 34.51, currency: 'GBP',
    merchant_code: credentials.merchantCode, timestamp: '2026-11-22T20:00:00+00:00',
  };
  let transaction = { ...successful };
  const adapter = sumupCheckouts(credentials, async (url) => {
    calls.push(String(url));
    if (String(url).includes('/checkouts/')) return Response.json({ ...checkout, status: 'PAID', transaction_id: 'provider-payment' });
    return Response.json(transaction);
  });
  assert.deepEqual(await adapter.verifyPayment(order, checkout.id), {
    checkoutId: checkout.id, transactionId: successful.id, paidAt: '2026-11-22T20:00:00.000Z',
  });
  assert.deepEqual(calls, [
    'https://api.sumup.com/v0.1/checkouts/provider-checkout',
    'https://api.sumup.com/v2.1/merchants/TESTMERCHANT/transactions?id=provider-payment',
  ]);
  transaction = { ...successful, status: 'REFUNDED' };
  assert.equal(await adapter.verifyPayment(order, checkout.id), null);
  transaction = { ...successful, amount: 1 };
  await assert.rejects(adapter.verifyPayment(order, checkout.id), /recorded payment transaction/);
});

test('pending returns no payment and a matched paid checkout returns its transaction ID', async () => {
  const pending = sumupCheckouts(credentials, async () => Response.json(checkout));
  assert.equal(await pending.verify(order, checkout.id), null);
  const paid = sumupCheckouts(credentials, async () => Response.json({
    ...checkout, status: 'PAID', transaction_id: 'provider-payment',
  }));
  assert.deepEqual(await paid.verify(order, checkout.id), {
    checkoutId: checkout.id, transactionId: 'provider-payment',
  });
});

test('a paid checkout with a different total, currency, merchant or reference is refused', async () => {
  for (const mismatch of [{ amount: 29 }, { currency: 'USD' }, { merchant_code: 'different' }, { checkout_reference: 'different' }]) {
    const adapter = sumupCheckouts(credentials, async () => Response.json({
      ...checkout, ...mismatch, status: 'PAID', transaction_id: 'provider-payment',
    }));
    await assert.rejects(adapter.verify(order, checkout.id), /does not match/);
  }
});

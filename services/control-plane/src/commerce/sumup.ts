import { z } from 'zod';

const transaction = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: z.number(),
  currency: z.string(),
  merchant_code: z.string(),
  timestamp: z.iso.datetime({ offset: true }),
  simple_status: z.string().optional(),
  events: z.array(z.object({ type: z.string(), status: z.string() })).optional(),
});

const checkout = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  checkout_reference: z.string(),
  amount: z.number(),
  currency: z.string(),
  merchant_code: z.string(),
  hosted_checkout_url: z.string().url().optional(),
  transaction_id: z.string().min(1).optional(),
});

interface Order {
  reference: string;
  totalPence: number;
}

export function sumupCheckouts(
  credentials: { apiKey: string; merchantCode: string },
  request = fetch,
) {
  async function call(path: string, options?: RequestInit) {
    const response = await request('https://api.sumup.com' + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + credentials.apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('SumUp checkout request failed.');
    return await response.json() as unknown;
  }

  function assertMatches(result: z.infer<typeof checkout>, order: Order) {
    if (result.checkout_reference !== order.reference || result.currency !== 'GBP'
      || result.amount !== order.totalPence / 100 || result.merchant_code !== credentials.merchantCode) {
      throw new Error('SumUp checkout does not match the recorded order.');
    }
  }

  async function retrievePaid(order: Order, checkoutId: string) {
    const result = checkout.parse(await call('/v0.1/checkouts/' + encodeURIComponent(checkoutId)));
    assertMatches(result, order);
    if (result.id !== checkoutId) throw new Error('SumUp checkout ID does not match the recorded order.');
    if (result.status !== 'PAID') return null;
    if (!result.transaction_id) throw new Error('SumUp did not return a transaction ID.');
    return result.transaction_id;
  }

  return {
    async create(order: Order, redirectUrl: string, callbackUrl?: string) {
      if (!Number.isSafeInteger(order.totalPence) || order.totalPence <= 0) throw new Error('Invalid checkout total.');
      const result = checkout.parse(await call('/v0.1/checkouts', {
        method: 'POST',
        body: JSON.stringify({
          checkout_reference: order.reference, currency: 'GBP', amount: order.totalPence / 100,
          merchant_code: credentials.merchantCode, description: 'InFlight Pro',
          hosted_checkout: { enabled: true }, redirect_url: redirectUrl,
          ...(callbackUrl ? { return_url: callbackUrl } : {}),
        }),
      }));
      assertMatches(result, order);
      if (!result.hosted_checkout_url || new URL(result.hosted_checkout_url).protocol !== 'https:') {
        throw new Error('SumUp did not supply a valid hosted checkout URL.');
      }
      return { checkoutId: result.id, url: result.hosted_checkout_url };
    },
    async verify(order: Order, checkoutId: string) {
      const transactionId = await retrievePaid(order, checkoutId);
      return transactionId ? { checkoutId, transactionId } : null;
    },
    async verifyPayment(order: Order, checkoutId: string) {
      const transactionId = await retrievePaid(order, checkoutId);
      if (!transactionId) return null;
      const path = '/v2.1/merchants/' + encodeURIComponent(credentials.merchantCode) + '/transactions?id=' + encodeURIComponent(transactionId);
      const attempt = transaction.parse(await call(path));
      if (attempt.id !== transactionId || attempt.currency !== 'GBP'
        || attempt.merchant_code !== credentials.merchantCode || attempt.amount !== order.totalPence / 100) {
        throw new Error('SumUp has not confirmed the recorded payment transaction.');
      }
      if (attempt.status !== 'SUCCESSFUL' || ['REFUNDED', 'CHARGEBACK'].includes(attempt.simple_status ?? '')
        || attempt.events?.some(({ type, status }) => (type === 'REFUND' || type === 'CHARGE_BACK') && ['REFUNDED', 'SUCCESSFUL'].includes(status))) return null;
      return { checkoutId, transactionId, paidAt: new Date(attempt.timestamp).toISOString() };
    },
  };
}

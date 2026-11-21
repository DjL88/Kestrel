import { z } from 'zod';

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
    const response = await request('https://api.sumup.com/v0.1/checkouts' + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + credentials.apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('SumUp checkout request failed.');
    return checkout.parse(await response.json());
  }

  function assertMatches(result: z.infer<typeof checkout>, order: Order) {
    if (result.checkout_reference !== order.reference || result.currency !== 'GBP'
      || result.amount !== order.totalPence / 100 || result.merchant_code !== credentials.merchantCode) {
      throw new Error('SumUp checkout does not match the recorded order.');
    }
  }

  return {
    async create(order: Order, redirectUrl: string) {
      if (!Number.isSafeInteger(order.totalPence) || order.totalPence <= 0) throw new Error('Invalid checkout total.');
      const result = await call('', {
        method: 'POST',
        body: JSON.stringify({
          checkout_reference: order.reference, currency: 'GBP', amount: order.totalPence / 100,
          merchant_code: credentials.merchantCode, description: 'Kestrel Pro',
          hosted_checkout: { enabled: true }, redirect_url: redirectUrl,
        }),
      });
      assertMatches(result, order);
      if (!result.hosted_checkout_url || new URL(result.hosted_checkout_url).protocol !== 'https:') {
        throw new Error('SumUp did not supply a valid hosted checkout URL.');
      }
      return { checkoutId: result.id, url: result.hosted_checkout_url };
    },
    async verify(order: Order, checkoutId: string) {
      const result = await call('/' + encodeURIComponent(checkoutId));
      assertMatches(result, order);
      if (result.id !== checkoutId) throw new Error('SumUp checkout ID does not match the recorded order.');
      if (result.status !== 'PAID') return null;
      if (!result.transaction_id) throw new Error('SumUp did not return a transaction ID.');
      return { checkoutId, transactionId: result.transaction_id };
    },
  };
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Paddle Billing (merchant of record). Paddle collects and remits VAT and sales tax, sends receipts and handles refunds;
 * we keep only the transaction reference. The API key and the notification secret live in Secret Manager.
 */

export const PADDLE_ID = /^[a-z]{2,4}_[a-z0-9]{26}$/;

const money = z.string().regex(/^\d{1,12}$/);
const transaction = z.object({
  id: z.string().regex(PADDLE_ID),
  status: z.string().min(1),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  custom_data: z.record(z.string(), z.unknown()).nullable().optional(),
  billed_at: z.string().nullable().optional(),
  items: z.array(z.object({ price: z.object({ id: z.string() }).nullable().optional(), quantity: z.number().int() })),
  details: z.object({ totals: z.object({ subtotal: money, tax: money, total: money }) }).nullable().optional(),
  checkout: z.object({ url: z.string().url().nullable().optional() }).nullable().optional(),
  address: z.object({ country_code: z.string().regex(/^[A-Z]{2}$/) }).nullable().optional(),
});
export type PaddleTransaction = z.infer<typeof transaction>;

/** Currencies Paddle bills in with two decimal places. Others are not offered as local prices. */
const TWO_DECIMAL = new Set(['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'CHF', 'DKK', 'NOK', 'NZD', 'SEK']);

/** The countries each local price applies to. Mirrors site/assets/prices.js; GBP is the base price, so not listed. */
export const PADDLE_PRICE_COUNTRIES: Readonly<Record<string, readonly string[]>> = {
  USD: ['US'],
  EUR: 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MC MT NL PT SI SK SM AD ME'.split(' '),
  CAD: ['CA'], AUD: ['AU'], NZD: ['NZ'], CHF: ['CH', 'LI'], DKK: ['DK'], SEK: ['SE'], NOK: ['NO'],
};

export function paddleApi(options: { apiKey: string; sandbox?: boolean }, request: typeof fetch = fetch) {
  const base = options.sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
  async function call(path: string, init?: RequestInit) {
    const response = await request(base + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
      signal: AbortSignal.timeout(10_000),
    });
    // Paddle's error body can echo request details; never pass it on.
    if (!response.ok) throw new Error('Paddle request failed (' + response.status + ').');
    return (await response.json() as { data: unknown }).data;
  }
  return {
    /** A ready transaction for one price, tagged with our own order reference. Paddle's checkout collects the rest. */
    async createTransaction(priceId: string, customData: Record<string, string>): Promise<PaddleTransaction> {
      return transaction.parse(await call('/transactions', {
        method: 'POST',
        body: JSON.stringify({ items: [{ price_id: priceId, quantity: 1 }], custom_data: customData, collection_mode: 'automatic' }),
      }));
    },
    async getTransaction(id: string): Promise<PaddleTransaction> {
      if (!PADDLE_ID.test(id)) throw new Error('Invalid Paddle transaction id.');
      return transaction.parse(await call('/transactions/' + id + '?include=address'));
    },
    /** Replace a price's base amount and its local prices (from an approved price review). */
    async setPrices(priceId: string, gbpPence: number, local: readonly { currency: string; major: number }[]) {
      if (!PADDLE_ID.test(priceId)) throw new Error('Invalid Paddle price id.');
      const overrides = local.flatMap(({ currency, major }) => {
        const countries = PADDLE_PRICE_COUNTRIES[currency];
        if (!countries || !TWO_DECIMAL.has(currency) || !(major > 0) || !Number.isFinite(major)) return [];
        return [{ country_codes: [...countries], unit_price: { amount: String(Math.round(major * 100)), currency_code: currency } }];
      });
      await call('/prices/' + priceId, {
        method: 'PATCH',
        body: JSON.stringify({ unit_price: { amount: String(gbpPence), currency_code: 'GBP' }, unit_price_overrides: overrides }),
      });
      return { overrides: overrides.length };
    },
  };
}
export type PaddleApi = ReturnType<typeof paddleApi>;

/**
 * Paddle-Signature: "ts=<unix seconds>;h1=<hex HMAC-SHA256 of `${ts}:${raw body}`>" (h1 may repeat during secret
 * rotation). Refuses anything outside the replay window.
 */
export function verifyPaddleSignature(rawBody: string, header: string | undefined, secret: string, nowMs: number, toleranceSeconds = 300): boolean {
  if (!header || !secret) return false;
  let ts = '';
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const [key, value] = part.split('=', 2);
    if (key === 'ts') ts = value ?? '';
    else if (key === 'h1' && value && /^[a-f0-9]{64}$/.test(value)) signatures.push(value);
  }
  if (!/^\d{1,12}$/.test(ts) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(ts + ':' + rawBody).digest();
  return signatures.some((hex) => timingSafeEqual(Buffer.from(hex, 'hex'), expected));
}

export const PaddleNotification = z.object({
  event_id: z.string().regex(/^evt_[a-z0-9]{26}$/),
  event_type: z.string().regex(/^[a-z_]{1,32}\.[a-z_]{1,32}$/),
  occurred_at: z.string().max(40),
  data: z.object({ id: z.string().max(64) }).passthrough(),
}).passthrough();

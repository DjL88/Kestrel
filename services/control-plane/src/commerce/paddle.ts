import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Paddle Billing (https://developer.paddle.com). Paddle is the merchant of record: it sells to the buyer, works out and
 * pays the buyer's sales tax or VAT anywhere in the world, and pays InFlight what is left. So the server never prices
 * tax itself. It names the Paddle price, binds the transaction to the signed-in account, and grants Pro only after it
 * has fetched the transaction back from Paddle and matched it.
 */

export type PaddleEnvironment = 'sandbox' | 'production';
export const paddleApiBase = (environment: PaddleEnvironment) =>
  environment === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

/** Paddle transaction IDs look like txn_01h04vsc0qhwtsbsxh3422wjs4. */
export const PADDLE_TRANSACTION_ID = /^txn_[a-z0-9]{10,60}$/;

const money = z.string().regex(/^-?\d{1,15}$/);
const transaction = z.object({
  id: z.string().regex(PADDLE_TRANSACTION_ID),
  status: z.enum(['draft', 'ready', 'billed', 'paid', 'completed', 'canceled', 'past_due']),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  custom_data: z.record(z.string(), z.unknown()).nullable().optional(),
  subscription_id: z.string().nullable().optional(),
  billed_at: z.string().nullable().optional(),
  updated_at: z.string().optional(),
  items: z.array(z.object({ price: z.object({ id: z.string() }).nullable().optional(), price_id: z.string().optional(), quantity: z.number() })),
  details: z.object({
    totals: z.object({ subtotal: money, tax: money, total: money, currency_code: z.string().regex(/^[A-Z]{3}$/) }),
    payout_totals: z.object({ subtotal: money, tax: money, total: money, fee: money, earnings: money, currency_code: z.string().regex(/^[A-Z]{3}$/) }).nullable().optional(),
  }),
  checkout: z.object({ url: z.string().nullable().optional() }).nullable().optional(),
  address: z.object({ country_code: z.string().regex(/^[A-Z]{2}$/) }).nullable().optional(),
  payments: z.array(z.object({ status: z.string(), captured_at: z.string().nullable().optional() })).optional(),
});
export type PaddleTransaction = z.infer<typeof transaction>;

/** Paddle adjustment IDs look like adj_01h04vsc0qhwtsbsxh3422wjs4. */
export const PADDLE_ADJUSTMENT_ID = /^adj_[a-z0-9]{10,60}$/;
/**
 * A refund, credit or chargeback against a transaction, as Paddle has it. `type` says whether it covers the whole
 * transaction ('full') or part of it ('partial'); a refund takes effect only once its status is 'approved'.
 */
const adjustment = z.object({
  id: z.string().regex(PADDLE_ADJUSTMENT_ID),
  action: z.string().max(40),
  type: z.enum(['full', 'partial']).nullable().optional(),
  status: z.string().max(40),
  transaction_id: z.string().regex(PADDLE_TRANSACTION_ID),
  totals: z.object({ total: money, currency_code: z.string().regex(/^[A-Z]{3}$/) }).partial().nullable().optional(),
}).passthrough();
export type PaddleAdjustment = z.infer<typeof adjustment>;

/** Paddle subscription IDs look like sub_01h04vsc0qhwtsbsxh3422wjs4. */
export const PADDLE_SUBSCRIPTION_ID = /^sub_[a-z0-9]{10,60}$/;
/**
 * A Pro subscription as Paddle has it. `current_billing_period` is the period paid for; Paddle leaves it empty once the
 * subscription is cancelled or paused. Paddle copies the first transaction's custom_data onto the subscription.
 */
const subscription = z.object({
  id: z.string().regex(PADDLE_SUBSCRIPTION_ID),
  status: z.enum(['active', 'trialing', 'past_due', 'paused', 'canceled']),
  custom_data: z.record(z.string(), z.unknown()).nullable().optional(),
  current_billing_period: z.object({ starts_at: z.string(), ends_at: z.string() }).nullable().optional(),
  /** Set when the person has cancelled (or paused) and it takes effect at the end of the paid period. */
  scheduled_change: z.object({ action: z.string(), effective_at: z.string() }).nullable().optional(),
  customer_id: z.string().regex(/^ctm_[a-z0-9]{10,60}$/).optional(),
}).passthrough();
export type PaddleSubscription = z.infer<typeof subscription>;

/** Paddle's own pages for one customer (cancel, payment details, receipts). Paddle hosts them; links expire. */
const portalSession = z.object({
  urls: z.object({
    general: z.object({ overview: z.string().url() }),
    subscriptions: z.array(z.object({ id: z.string(), cancel_subscription: z.string().url(), update_subscription_payment_method: z.string().url() })).optional(),
  }),
}).passthrough();
/** Paddle's customer portal hosts (production and sandbox). Nothing else is ever handed to the app. */
export const isPaddlePortalUrl = (value: string) => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'customer-portal.paddle.com' || u.hostname === 'sandbox-customer-portal.paddle.com');
  } catch { return false; }
};

const PADDLE_PRICE_ID = /^pri_[a-z0-9]{10,60}$/;
const priceMoney = z.object({ amount: z.string().regex(/^\d{1,12}$/), currency_code: z.string().regex(/^[A-Z]{3}$/) });
const paddlePrice = z.object({
  id: z.string().regex(PADDLE_PRICE_ID),
  unit_price: priceMoney,
  unit_price_overrides: z.array(z.object({ country_codes: z.array(z.string()), unit_price: priceMoney })).nullable().optional().transform((v) => v ?? []),
}).passthrough();

/** Paddle discount IDs look like dsc_01h04vsc0qhwtsbsxh3422wjs4. */
export const PADDLE_DISCOUNT_ID = /^dsc_[a-z0-9]{10,60}$/;
/**
 * A discount made in the Paddle dashboard (Catalog, then Discounts). Paddle owns its dates and limits: `expires_at`,
 * `usage_limit` and `status`. Paddle sets the status to 'expired' or 'used' by itself and refuses a spent discount.
 */
const paddleDiscount = z.object({
  id: z.string().regex(PADDLE_DISCOUNT_ID),
  status: z.string().max(40),
  expires_at: z.string().nullable().optional(),
  usage_limit: z.number().nullable().optional(),
  times_used: z.number().nullable().optional(),
}).passthrough();
export type PaddleDiscount = z.infer<typeof paddleDiscount>;

/** Is a Paddle discount usable now, by Paddle's own status, expiry and usage limit? */
export function discountLive(d: PaddleDiscount, nowMs: number): boolean {
  if (d.status !== 'active') return false;
  if (d.expires_at && !(Date.parse(d.expires_at) > nowMs)) return false;
  if (typeof d.usage_limit === 'number' && (d.times_used ?? 0) >= d.usage_limit) return false;
  return true;
}

export interface PaddleCredentials {
  /** The key, or a function giving the current key (re-read from Secret Manager after a rotation). */
  apiKey: string | (() => Promise<string>);
  environment: PaddleEnvironment;
}

export function paddleApi(credentials: PaddleCredentials, request: typeof fetch = fetch) {
  const base = paddleApiBase(credentials.environment);
  async function raw(path: string, options?: RequestInit): Promise<unknown> {
    const apiKey = typeof credentials.apiKey === 'function' ? await credentials.apiKey() : credentials.apiKey;
    const response = await request(base + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Paddle request failed with ' + response.status + '.');
    const body = await response.json() as { data?: unknown };
    return body.data;
  }
  const call = async (path: string, options?: RequestInit): Promise<PaddleTransaction> => transaction.parse(await raw(path, options));
  return {
    /**
     * A transaction for one price, opened by Paddle.js on our checkout page (`checkoutUrl`, an approved domain in
     * Paddle). Paddle adds `?_ptxn=<id>` to that address. Nothing is charged until the buyer pays on Paddle's form.
     */
    async createTransaction(input: { priceId: string; customData: Record<string, string>; checkoutUrl: string; discountId?: string }) {
      if (new URL(input.checkoutUrl).protocol !== 'https:') throw new Error('The Paddle checkout page must use HTTPS.');
      const created = await call('/transactions', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ price_id: input.priceId, quantity: 1 }],
          custom_data: input.customData,
          collection_mode: 'automatic',
          checkout: { url: input.checkoutUrl },
          ...(input.discountId ? { discount_id: input.discountId } : {}),
        }),
      });
      const url = created.checkout?.url;
      if (!url || new URL(url).protocol !== 'https:') throw new Error('Paddle did not return a checkout address.');
      return { transactionId: created.id, url };
    },
    /** A discount as Paddle has it now (its status, expiry and usage). */
    async getDiscount(id: string) {
      if (!PADDLE_DISCOUNT_ID.test(id)) throw new Error('Invalid Paddle discount ID.');
      return paddleDiscount.parse(await raw('/discounts/' + encodeURIComponent(id)));
    },
    /** One price as Paddle has it: the base amount and the country overrides (the pricing matrix checks these). */
    async getPrice(id: string) {
      if (!PADDLE_PRICE_ID.test(id)) throw new Error('Invalid Paddle price ID.');
      return paddlePrice.parse(await raw('/prices/' + encodeURIComponent(id)));
    },
    /**
     * Sets a price's base amount and country overrides from the pricing matrix. Paddle applies it to new checkouts;
     * existing subscriptions keep the price they were sold at.
     */
    async updatePrice(id: string, body: { unit_price: { amount: string; currency_code: string }; unit_price_overrides: { country_codes: string[]; unit_price: { amount: string; currency_code: string } }[] }) {
      if (!PADDLE_PRICE_ID.test(id)) throw new Error('Invalid Paddle price ID.');
      return paddlePrice.parse(await raw('/prices/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }));
    },
    /**
     * What these prices cost in one country, as Paddle would charge them (POST /pricing-preview). Only the country code
     * is sent, never a visitor's address. Returns Paddle's `data` for `readPricePreview` (localPricing.ts).
     */
    async previewPrices(priceIds: string[], countryCode: string): Promise<unknown> {
      if (!/^[A-Z]{2}$/.test(countryCode) || priceIds.length === 0 || !priceIds.every((id) => PADDLE_PRICE_ID.test(id))) throw new Error('Invalid pricing preview.');
      return raw('/pricing-preview', {
        method: 'POST',
        body: JSON.stringify({ items: priceIds.map((price_id) => ({ price_id, quantity: 1 })), address: { country_code: countryCode } }),
      });
    },
    /** The transaction as Paddle has it now, with the buyer's country. Never trust a webhook body on its own. */
    getTransaction: (id: string) => {
      if (!PADDLE_TRANSACTION_ID.test(id)) throw new Error('Invalid Paddle transaction ID.');
      return call('/transactions/' + encodeURIComponent(id) + '?include=address');
    },
    /** The subscription as Paddle has it now. Never trust a webhook body on its own. */
    async getSubscription(id: string): Promise<PaddleSubscription> {
      if (!PADDLE_SUBSCRIPTION_ID.test(id)) throw new Error('Invalid Paddle subscription ID.');
      return subscription.parse(await raw('/subscriptions/' + encodeURIComponent(id)));
    },
    /**
     * A customer portal session for one subscription: Paddle's own page to cancel it, change the card or see receipts.
     * Paddle runs the cancellation; its notification then moves the licence's end date (proSettlement.ts).
     */
    async createPortalSession(customerId: string, subscriptionId: string) {
      if (!/^ctm_[a-z0-9]{10,60}$/.test(customerId) || !PADDLE_SUBSCRIPTION_ID.test(subscriptionId)) throw new Error('Invalid Paddle customer or subscription ID.');
      const session = portalSession.parse(await raw('/customers/' + encodeURIComponent(customerId) + '/portal-sessions', {
        method: 'POST', body: JSON.stringify({ subscription_ids: [subscriptionId] }),
      }));
      const links = session.urls.subscriptions?.find((s) => s.id === subscriptionId);
      const manageUrl = session.urls.general.overview;
      if (!isPaddlePortalUrl(manageUrl) || (links && (!isPaddlePortalUrl(links.cancel_subscription) || !isPaddlePortalUrl(links.update_subscription_payment_method)))) {
        throw new Error('Paddle returned an unexpected portal address.');
      }
      return { manageUrl, cancelUrl: links?.cancel_subscription ?? manageUrl, paymentUrl: links?.update_subscription_payment_method ?? manageUrl };
    },
    /** The adjustment as Paddle has it now (refund, credit, chargeback), or null when Paddle has no such adjustment. */
    async getAdjustment(id: string): Promise<PaddleAdjustment | null> {
      if (!PADDLE_ADJUSTMENT_ID.test(id)) throw new Error('Invalid Paddle adjustment ID.');
      const list = z.array(z.unknown()).parse(await raw('/adjustments?id=' + encodeURIComponent(id)));
      const found = list.map((item) => adjustment.parse(item)).find((a) => a.id === id);
      return found ?? null;
    },
  };
}

/** How far a webhook's signed timestamp may be from our clock. Paddle retries with a fresh signature each time. */
export const PADDLE_SIGNATURE_TOLERANCE_S = 300;

/**
 * Paddle-Signature: `ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<raw body>" with the endpoint's secret key>`.
 * During a secret rotation Paddle sends several h1 values; any one matching is enough.
 */
export function verifyPaddleSignature(rawBody: string, header: string | undefined, secret: string, nowMs: number): boolean {
  if (!header || !secret) return false;
  const parts = header.split(';').map((part) => part.trim().split('='));
  const ts = parts.find(([k]) => k === 'ts')?.[1];
  const signatures = parts.filter(([k, v]) => k === 'h1' && v && /^[a-f0-9]{64}$/.test(v)).map(([, v]) => v!);
  if (!ts || !/^\d{1,12}$/.test(ts) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > PADDLE_SIGNATURE_TOLERANCE_S) return false;
  const expected = crypto.createHmac('sha256', secret).update(ts + ':' + rawBody).digest();
  return signatures.some((signature) => crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expected));
}

/** Only the envelope is read from the body; the transaction itself is always fetched again from Paddle. */
export const PaddleEvent = z.object({
  event_id: z.string().min(1).max(128),
  event_type: z.string().min(1).max(64),
  occurred_at: z.string().max(64),
  data: z.object({ id: z.string().max(128).optional(), subscription_id: z.string().max(128).nullable().optional() }).passthrough(),
});

/** Paid in full: Paddle has captured the money. 'completed' follows once Paddle has finished processing. */
export const isPaddlePaid = (t: Pick<PaddleTransaction, 'status'>) => t.status === 'paid' || t.status === 'completed';

/** Pence (or cents) from Paddle's string amounts in the lowest unit. */
export const minorUnits = (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Invalid Paddle amount.');
  return n;
};

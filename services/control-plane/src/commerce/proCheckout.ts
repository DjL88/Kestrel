import { randomBytes } from 'node:crypto';
import type { ProPurchaseOrder } from './proSettlement.ts';
import { discountLive, type paddleApi } from './paddle.ts';

/** The major version recorded on new orders. A subscription covers whichever version is current while it is paid. */
export const PRO_MAJOR_VERSION_ON_SALE = 1;

/**
 * Pro is sold only as a subscription (owner decision, 26 Nov 2026): monthly or annual. Basic stays free. Pro Plus
 * (owner, 28 Nov 2026) is `plus` (£9.99 a month) or `plusAnnual` (£99.99 a year): everything in Pro with 5,000 cloud photos
 * a month instead of 500. Pro's `monthly` and `annual` carry 500. The one-off
 * licence is no longer sold, but licences already bought are still honoured (proSettlement.ts settles old orders).
 */
export const PRO_PLANS = ['monthly', 'annual', 'plus', 'plusAnnual'] as const;
export type ProPlan = typeof PRO_PLANS[number];

export interface StoredProOrder extends ProPurchaseOrder {
  transactionId: string;
  createdAt: string;
  /** The Paddle discount applied because Paddle said it was live when this checkout started (for example Black Friday). */
  discountId?: string;
}

export interface ProOrders {
  save(order: StoredProOrder): Promise<void>;
  get(transactionId: string): Promise<StoredProOrder | null>;
}

interface Dependencies {
  paddle: Pick<ReturnType<typeof paddleApi>, 'createTransaction'> & Partial<Pick<ReturnType<typeof paddleApi>, 'getDiscount'>>;
  orders: ProOrders;
  /** The Paddle recurring prices (set in the Paddle dashboard). A plan without a price is not offered. */
  priceIds: Partial<Record<ProPlan, string>>;
  /** HTTPS page on our site that loads Paddle.js and opens the checkout (site/pro-checkout.html). */
  checkoutUrl: string;
  /** Verified settlement (re-fetches the transaction from Paddle); safe to call repeatedly. */
  settle: (transactionId: string) => Promise<'paid' | 'pending' | 'unknown'>;
  /**
   * Optional offer discount (a Paddle discount ID such as dsc_…, made in the Paddle dashboard). Paddle decides when it
   * runs: it is applied only while Paddle reports it active, before its expiry and under its usage limit. There is no
   * date or price of our own. Buyers can also type any Paddle discount code on Paddle's checkout form.
   */
  promoDiscountId?: string;
  now?: () => number;
}

/**
 * Server-owned order: the Paddle price is chosen here and the transaction is bound to the signed-in account before
 * Paddle sees it. Paddle, as merchant of record, collects the buyer's country and charges the right tax itself, so no
 * country or location is asked for. Fulfilment happens only through the verified settlement.
 */
export function paddleProCheckout(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  if (new URL(deps.checkoutUrl).protocol !== 'https:') throw new Error('The checkout page must use HTTPS.');
  if (!PRO_PLANS.some((plan) => deps.priceIds[plan])) throw new Error('No Pro subscription price is set.');
  // Paddle's view of the offer, re-read at most every five minutes. A failed read counts as no offer (full price).
  const OFFER_TTL_MS = 5 * 60_000;
  let cached: { at: number; live: boolean; expiresAt: string | null } | null = null;
  async function offer(): Promise<{ live: boolean; expiresAt: string | null }> {
    if (!deps.promoDiscountId || !deps.paddle.getDiscount) return { live: false, expiresAt: null };
    const t = now();
    if (!cached || t - cached.at >= OFFER_TTL_MS) {
      try {
        const d = await deps.paddle.getDiscount(deps.promoDiscountId);
        cached = { at: t, live: discountLive(d, t), expiresAt: d.expires_at ?? null };
      } catch { cached = { at: t, live: false, expiresAt: null }; }
    }
    // The expiry can pass between reads.
    const live = cached.live && !(cached.expiresAt && Date.parse(cached.expiresAt) <= t);
    return { live, expiresAt: live ? cached.expiresAt : null };
  }
  return {
    /** The offer as Paddle has it, for the website banner: its last day (UTC), or null when there is none or no end. */
    async offer(): Promise<{ live: boolean; lastDay: string | null }> {
      const o = await offer();
      // Paddle's expiry is an exact moment; the last full day is the day before it, unless it ends after midnight.
      const lastDay = o.expiresAt ? new Date(Date.parse(o.expiresAt) - 1).toISOString().slice(0, 10) : null;
      return { live: o.live, lastDay };
    },
    /** The plans that can be bought now. */
    plans: PRO_PLANS.filter((plan) => !!deps.priceIds[plan]),
    async start(input: { accountId: string; emailHash: string; plan: ProPlan }) {
      const priceId = deps.priceIds[input.plan];
      if (!priceId) throw new Error('That Pro plan is not on sale.');
      const at = new Date(now()).toISOString();
      const reference = 'paddle_' + randomBytes(12).toString('hex');
      const invoiceNumber = 'INF-' + at.slice(0, 10).replaceAll('-', '') + '-' + reference.slice(7, 17).toUpperCase();
      const discountId = (await offer()).live ? deps.promoDiscountId : undefined;
      const created = await deps.paddle.createTransaction({
        priceId, checkoutUrl: deps.checkoutUrl, ...(discountId ? { discountId } : {}),
        customData: { reference, accountId: input.accountId, product: 'pro', plan: input.plan, majorVersion: String(PRO_MAJOR_VERSION_ON_SALE) },
      });
      await deps.orders.save({
        transactionId: created.transactionId, createdAt: at, reference, accountId: input.accountId, emailHash: input.emailHash,
        majorVersion: PRO_MAJOR_VERSION_ON_SALE, invoiceNumber, priceId, plan: input.plan, ...(discountId ? { discountId } : {}),
      });
      return { checkoutId: created.transactionId, url: created.url, plan: input.plan };
    },
    /** null when the checkout is not this account's, so another person's order is indistinguishable from none. */
    async status(input: { accountId: string; checkoutId: string }): Promise<'paid' | 'pending' | null> {
      const order = await deps.orders.get(input.checkoutId);
      if (!order || order.accountId !== input.accountId) return null;
      return (await deps.settle(input.checkoutId)) === 'paid' ? 'paid' : 'pending';
    },
  };
}

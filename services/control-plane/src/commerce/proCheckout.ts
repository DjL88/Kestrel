import { randomBytes } from 'node:crypto';
import type { ProPurchaseOrder } from './proSettlement.ts';
import type { paddleApi } from './paddle.ts';

/** The major version recorded on new orders. A subscription covers whichever version is current while it is paid. */
export const PRO_MAJOR_VERSION_ON_SALE = 1;

/**
 * Pro is sold only as a subscription (owner decision, 26 Nov 2026): monthly or annual. Basic stays free. The one-off
 * licence is no longer sold, but licences already bought are still honoured (proSettlement.ts settles old orders).
 */
export const PRO_PLANS = ['monthly', 'annual'] as const;
export type ProPlan = typeof PRO_PLANS[number];

export interface StoredProOrder extends ProPurchaseOrder {
  transactionId: string;
  createdAt: string;
  /** The Paddle discount applied because the offer was on when this checkout started (for example Black Friday). */
  discountId?: string;
}

export interface ProOrders {
  save(order: StoredProOrder): Promise<void>;
  get(transactionId: string): Promise<StoredProOrder | null>;
}

interface Dependencies {
  paddle: Pick<ReturnType<typeof paddleApi>, 'createTransaction'>;
  orders: ProOrders;
  /** The Paddle recurring prices (set in the Paddle dashboard). A plan without a price is not offered. */
  priceIds: Partial<Record<ProPlan, string>>;
  /** HTTPS page on our site that loads Paddle.js and opens the checkout (site/pro-checkout.html). */
  checkoutUrl: string;
  /** Verified settlement (re-fetches the transaction from Paddle); safe to call repeatedly. */
  settle: (transactionId: string) => Promise<'paid' | 'pending' | 'unknown'>;
  /**
   * Optional offer discount (a Paddle discount ID such as dsc_…, made in the Paddle dashboard). It is applied only to a
   * checkout started while the offer is on (the admin flag proPromo, with its dates), by someone signed in at that time.
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
  return {
    /** The plans that can be bought now. */
    plans: PRO_PLANS.filter((plan) => !!deps.priceIds[plan]),
    async start(input: { accountId: string; emailHash: string; promo?: boolean; plan: ProPlan }) {
      const priceId = deps.priceIds[input.plan];
      if (!priceId) throw new Error('That Pro plan is not on sale.');
      const at = new Date(now()).toISOString();
      const reference = 'paddle_' + randomBytes(12).toString('hex');
      const invoiceNumber = 'INF-' + at.slice(0, 10).replaceAll('-', '') + '-' + reference.slice(7, 17).toUpperCase();
      const discountId = input.promo && deps.promoDiscountId ? deps.promoDiscountId : undefined;
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

import { randomBytes } from 'node:crypto';
import type { ProPurchaseOrder } from './proSettlement.ts';
import type { paddleApi } from './paddle.ts';

/** Pro is a one-off licence per major version; the server decides which version is on sale, never the client. */
export const PRO_MAJOR_VERSION_ON_SALE = 1;

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
  /** The Paddle price for lifetime Pro (£29, set in the Paddle dashboard). */
  priceId: string;
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
  return {
    async start(input: { accountId: string; emailHash: string; promo?: boolean }) {
      const at = new Date(now()).toISOString();
      const reference = 'paddle_' + randomBytes(12).toString('hex');
      const invoiceNumber = 'INF-' + at.slice(0, 10).replaceAll('-', '') + '-' + reference.slice(7, 17).toUpperCase();
      const discountId = input.promo && deps.promoDiscountId ? deps.promoDiscountId : undefined;
      const created = await deps.paddle.createTransaction({
        priceId: deps.priceId, checkoutUrl: deps.checkoutUrl, ...(discountId ? { discountId } : {}),
        customData: { reference, accountId: input.accountId, product: 'pro', majorVersion: String(PRO_MAJOR_VERSION_ON_SALE) },
      });
      await deps.orders.save({
        transactionId: created.transactionId, createdAt: at, reference, accountId: input.accountId, emailHash: input.emailHash,
        majorVersion: PRO_MAJOR_VERSION_ON_SALE, invoiceNumber, priceId: deps.priceId, ...(discountId ? { discountId } : {}),
      });
      return { checkoutId: created.transactionId, url: created.url };
    },
    /** null when the checkout is not this account's, so another person's order is indistinguishable from none. */
    async status(input: { accountId: string; checkoutId: string }): Promise<'paid' | 'pending' | null> {
      const order = await deps.orders.get(input.checkoutId);
      if (!order || order.accountId !== input.accountId) return null;
      return (await deps.settle(input.checkoutId)) === 'paid' ? 'paid' : 'pending';
    },
  };
}

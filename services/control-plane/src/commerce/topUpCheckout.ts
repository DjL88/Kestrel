import { randomBytes } from 'node:crypto';
import type { CloudBalance } from '../cloudBalance.ts';
import type { CommerceLedger } from './ledger.ts';
import { isPaddlePaid, minorUnits, type paddleApi, type PaddleTransaction } from './paddle.ts';

/**
 * Cloud top-ups (owner decision, 26 Nov 2026): prepaid one-off purchases of cloud balance, £5, £10 or £20, sold through
 * Paddle (merchant of record). Not a subscription and not a Pro licence. 1 credit = 1p of the price paid, including
 * VAT, because the cloud price list (src/core/cloudPlan.ts) is quoted including VAT. The balance never expires; an
 * unused balance is refunded when the account is deleted (accountErasure.ts).
 *
 * Trust rules, the same as for Pro: the server picks the Paddle price for the amount, binds the transaction to the
 * signed-in account before Paddle sees it, and credits the balance only after fetching the transaction back from
 * Paddle and matching it to the stored order. The credit is keyed by the order, so a retried notification adds once.
 */
export const TOP_UP_AMOUNTS_PENCE = [500, 1000, 2000] as const;
export type TopUpPence = typeof TOP_UP_AMOUNTS_PENCE[number];

export interface TopUpOrder {
  transactionId: string;
  /** Our reference (custom_data.reference): the key for the sale and for the balance credit. */
  reference: string;
  accountId: string;
  pence: TopUpPence;
  priceId: string;
  invoiceNumber: string;
  createdAt: string;
}

export interface TopUpOrders {
  save(order: TopUpOrder): Promise<void>;
  get(transactionId: string): Promise<TopUpOrder | null>;
}

interface Dependencies {
  paddle: Pick<ReturnType<typeof paddleApi>, 'createTransaction'> & { getTransaction(id: string): Promise<PaddleTransaction> };
  orders: TopUpOrders;
  /** The Paddle one-off price for each amount. An amount without a price is not offered. */
  priceIds: Partial<Record<TopUpPence, string>>;
  /** The same checkout page as Pro (site/pro-checkout.html), which opens any of our Paddle transactions. */
  checkoutUrl: string;
  commerce: Pick<CommerceLedger, 'recordPaid'>;
  balance: Pick<CloudBalance, 'credit'>;
  now?: () => number;
}

export const topUpCreditKey = (order: Pick<TopUpOrder, 'reference'>) => `topup:${order.reference}`;

export function paddleTopUps(d: Dependencies) {
  const now = d.now ?? Date.now;
  if (new URL(d.checkoutUrl).protocol !== 'https:') throw new Error('The checkout page must use HTTPS.');
  if (!TOP_UP_AMOUNTS_PENCE.some((p) => d.priceIds[p])) throw new Error('No top-up price is set.');

  /** Verified fulfilment: safe to call any number of times. 'unknown' when the transaction is not a top-up order. */
  async function settle(transactionId: string): Promise<'paid' | 'pending' | 'unknown'> {
    const order = await d.orders.get(transactionId);
    if (!order) return 'unknown';
    const t = await d.paddle.getTransaction(transactionId);
    if (t.id !== transactionId || t.custom_data?.reference !== order.reference || t.custom_data?.accountId !== order.accountId
      || t.subscription_id || t.items.length !== 1 || t.items[0]!.quantity !== 1
      || (t.items[0]!.price?.id ?? t.items[0]!.price_id) !== order.priceId) {
      throw new Error('The Paddle transaction does not match the recorded top-up.');
    }
    if (!isPaddlePaid(t) || !t.details.payout_totals) return 'pending';
    const paidAt = new Date(Date.parse(t.billed_at ?? t.updated_at ?? '') || now()).toISOString();
    const payout = t.details.payout_totals;
    const earnings = minorUnits(payout.earnings);
    const supplyDate = paidAt.slice(0, 10);
    const buyerCountry = t.address?.country_code ?? null;
    const sale = await d.commerce.recordPaid({
      currency: payout.currency_code, country: 'GB', jurisdiction: 'GB', customerType: 'B2B', treatment: 'merchant-of-record',
      rateBasisPoints: 0, netPence: earnings, taxPence: 0, totalPence: earnings, vatNumber: null, invoiceNotice: null,
      verification: null, evidence: buyerCountry ? [{ source: 'billing-address', country: buyerCountry, observedAt: paidAt }] : [],
      store: 'paddle',
      buyer: { country: buyerCountry, currency: t.details.totals.currency_code, totalMinor: minorUnits(t.details.totals.total), taxMinor: minorUnits(t.details.totals.tax) },
      storeFeeMinor: minorUnits(payout.fee),
      checkoutReference: order.reference, providerCheckoutId: transactionId, providerTransactionId: transactionId,
      accountId: order.accountId, status: 'paid', supplyDate, paidAt,
      retainThrough: String(Number(supplyDate.slice(0, 4)) + 10) + '-12-31',
      invoiceNumber: order.invoiceNumber,
    });
    if (sale.status !== 'paid' || sale.accountId !== order.accountId) return 'pending';
    // The amount bought, whatever currency the buyer paid in: the price list is in pence including VAT.
    await d.balance.credit(order.accountId, order.pence * 1000, topUpCreditKey(order));
    return 'paid';
  }

  return {
    amounts: TOP_UP_AMOUNTS_PENCE.filter((p) => !!d.priceIds[p]),
    settle,
    async start(input: { accountId: string; pence: TopUpPence }) {
      const priceId = d.priceIds[input.pence];
      if (!priceId) throw new Error('That top-up is not on sale.');
      const at = new Date(now()).toISOString();
      const reference = 'paddle_t' + randomBytes(12).toString('hex');
      const invoiceNumber = 'INF-' + at.slice(0, 10).replaceAll('-', '') + '-T' + reference.slice(8, 17).toUpperCase();
      const created = await d.paddle.createTransaction({
        priceId, checkoutUrl: d.checkoutUrl,
        customData: { reference, accountId: input.accountId, product: 'cloud-top-up', pence: String(input.pence) },
      });
      await d.orders.save({ transactionId: created.transactionId, reference, accountId: input.accountId, pence: input.pence, priceId, invoiceNumber, createdAt: at });
      return { checkoutId: created.transactionId, url: created.url, totalPence: input.pence, currency: 'GBP' };
    },
    /** null when the checkout is not this account's top-up, so another person's order looks like none. */
    async status(input: { accountId: string; checkoutId: string }): Promise<'paid' | 'pending' | null> {
      const order = await d.orders.get(input.checkoutId);
      if (!order || order.accountId !== input.accountId) return null;
      return (await settle(input.checkoutId)) === 'paid' ? 'paid' : 'pending';
    },
  };
}

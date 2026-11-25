import { randomBytes } from 'node:crypto';
import { purchaseEntitlement } from '../entitlement.ts';
import type { Store } from '../store.ts';
import type { PaddleApi } from './paddle.ts';
import { PRO_MAJOR_VERSION_ON_SALE } from './proCheckout.ts';

/** Bound to the signed-in account on the server before the buyer sees Paddle. Keyed by Paddle's transaction id. */
export interface PaddleProOrder {
  transactionId: string;
  reference: string;
  accountId: string;
  emailHash: string;
  priceId: string;
  majorVersion: number;
  createdAt: string;
}

/** What we keep of a Paddle sale. Paddle is the seller of record and holds the tax, invoice and buyer details. */
export interface PaddleSaleRecord {
  reference: string;
  provider: 'paddle';
  providerTransactionId: string;
  accountId: string;
  priceId: string;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  country: string | null;
  paidAt: string;
  status: 'paid';
}

export interface PaddleOrders {
  save(order: PaddleProOrder): Promise<void>;
  get(transactionId: string): Promise<PaddleProOrder | null>;
}

interface Dependencies {
  api: Pick<PaddleApi, 'createTransaction' | 'getTransaction'>;
  orders: PaddleOrders;
  /** Idempotent by reference; a replay returns the first record. */
  recordSale: (sale: PaddleSaleRecord) => Promise<PaddleSaleRecord>;
  licences: Pick<Store, 'getAccount' | 'grantLicence' | 'listLicencesForAccount'>;
  proPriceId: string;
  now?: () => number;
}

const PAID = new Set(['paid', 'completed']);

/**
 * Pro (one-off) through Paddle. The server picks the price and binds the order to the account; Paddle's checkout
 * collects the address, works out tax and takes the payment. Pro is granted only after the server reads the transaction
 * back from Paddle's API and it matches the order: never from a browser redirect or the notification body alone.
 */
export function paddleProCheckout(deps: Dependencies) {
  const now = deps.now ?? Date.now;

  async function settle(transactionId: string): Promise<'paid' | 'pending' | 'unknown'> {
    const order = await deps.orders.get(transactionId);
    if (!order) return 'unknown';
    const account = await deps.licences.getAccount(order.accountId);
    if (!account || account.emailHash !== order.emailHash) throw new Error('Pro payment has no matching account.');
    const txn = await deps.api.getTransaction(transactionId);
    if (!PAID.has(txn.status)) return 'pending';
    const item = txn.items.length === 1 ? txn.items[0] : undefined;
    if (txn.id !== transactionId || txn.custom_data?.inflight_reference !== order.reference
      || txn.custom_data?.inflight_account !== order.accountId || item?.price?.id !== order.priceId || item.quantity !== 1
      || !txn.details) {
      throw new Error('The Paddle transaction does not match the order.');
    }
    const paidAt = txn.billed_at && Number.isFinite(Date.parse(txn.billed_at)) ? new Date(txn.billed_at).toISOString() : new Date(now()).toISOString();
    const sale = await deps.recordSale({
      reference: order.reference, provider: 'paddle', providerTransactionId: txn.id, accountId: order.accountId,
      priceId: order.priceId, currency: txn.currency_code,
      subtotalMinor: Number(txn.details.totals.subtotal), taxMinor: Number(txn.details.totals.tax), totalMinor: Number(txn.details.totals.total),
      country: txn.address?.country_code ?? null, paidAt, status: 'paid',
    });
    if (sale.providerTransactionId !== txn.id || sale.accountId !== order.accountId) throw new Error('The reference already identifies a different payment.');
    await deps.licences.grantLicence(purchaseEntitlement({
      checkoutReference: order.reference, accountId: order.accountId, emailHash: order.emailHash, majorVersion: order.majorVersion,
    }, Date.parse(paidAt)));
    return 'paid';
  }

  return {
    provider: 'paddle' as const,
    settle,
    /** Paddle works out tax and location itself, so no country checks here; `country` is ignored. */
    async start(input: { accountId: string; emailHash: string }) {
      const reference = 'pro_' + randomBytes(12).toString('hex');
      const txn = await deps.api.createTransaction(deps.proPriceId, { inflight_reference: reference, inflight_account: input.accountId });
      const url = txn.checkout?.url;
      if (!url || new URL(url).protocol !== 'https:') throw new Error('Paddle returned no checkout page. Set the default payment link in Paddle.');
      await deps.orders.save({
        transactionId: txn.id, reference, accountId: input.accountId, emailHash: input.emailHash, priceId: deps.proPriceId,
        majorVersion: PRO_MAJOR_VERSION_ON_SALE, createdAt: new Date(now()).toISOString(),
      });
      const total = Number(txn.details?.totals.total);
      return { checkoutId: txn.id, url, totalPence: Number.isSafeInteger(total) && total > 0 ? total : null, currency: txn.currency_code };
    },
    /** null when the transaction is not this account's, so someone else's order looks the same as none. */
    async status(input: { accountId: string; checkoutId: string }): Promise<'paid' | 'pending' | null> {
      const order = await deps.orders.get(input.checkoutId);
      if (!order || order.accountId !== input.accountId) return null;
      const result = await settle(input.checkoutId);
      if (result === 'paid') return 'paid';
      const licences = await deps.licences.listLicencesForAccount(input.accountId);
      return licences.some((l) => l.licenceId === 'lic_p_' + order.reference && l.paid) ? 'paid' : 'pending';
    },
  };
}
export type PaddleProCheckout = ReturnType<typeof paddleProCheckout>;

import { purchaseEntitlement } from '../entitlement.ts';
import type { Store } from '../store.ts';
import type { CommerceLedger } from './ledger.ts';
import { isPaddlePaid, minorUnits, type PaddleTransaction } from './paddle.ts';

/** Server-owned order, bound to a verified account before Paddle sees it. */
export interface ProPurchaseOrder {
  /** Our reference, sent to Paddle as custom_data.reference: the idempotency key for the sale and the licence. */
  reference: string;
  accountId: string;
  emailHash: string;
  majorVersion: number;
  invoiceNumber: string;
  /** The Paddle price the order was opened for. */
  priceId: string;
}

interface Dependencies {
  findOrder: (transactionId: string) => Promise<ProPurchaseOrder | null>;
  paddle: { getTransaction(id: string): Promise<PaddleTransaction> };
  commerce: Pick<CommerceLedger, 'recordPaid'>;
  licences: Pick<Store, 'getAccount' | 'grantLicence'>;
}

/**
 * Reconcile by Paddle transaction ID, from the signed webhook or from the app's status check. The transaction is
 * always fetched back from Paddle and matched to the stored order. Safe to call any number of times: the sale and
 * the licence both use the order's reference as their key.
 */
export function paddleProSettlement({ findOrder, paddle, commerce, licences }: Dependencies) {
  return async (transactionId: string): Promise<'paid' | 'pending' | 'unknown'> => {
    const order = await findOrder(transactionId);
    if (!order) return 'unknown';

    const account = await licences.getAccount(order.accountId);
    if (!account || account.emailHash !== order.emailHash) throw new Error('Pro payment has no matching account.');
    const t = await paddle.getTransaction(transactionId);
    if (t.id !== transactionId || t.custom_data?.reference !== order.reference || t.custom_data?.accountId !== order.accountId
      || t.subscription_id || t.items.length !== 1 || t.items[0]!.quantity !== 1
      || (t.items[0]!.price?.id ?? t.items[0]!.price_id) !== order.priceId) {
      throw new Error('The Paddle transaction does not match the recorded order.');
    }
    // 'completed' is Paddle's signal to fulfil: paid, and the payout figures are final.
    if (!isPaddlePaid(t) || !t.details.payout_totals) return 'pending';

    const paidAt = new Date(Date.parse(t.billed_at ?? t.updated_at ?? '') || Date.now()).toISOString();
    const payout = t.details.payout_totals;
    const earnings = minorUnits(payout.earnings);
    const supplyDate = paidAt.slice(0, 10);
    const buyerCountry = t.address?.country_code ?? null;
    const sale = await commerce.recordPaid({
      // InFlight's sale is to Paddle (a UK reseller); Paddle accounted for the buyer's tax.
      currency: payout.currency_code, country: 'GB', jurisdiction: 'GB', customerType: 'B2B', treatment: 'merchant-of-record',
      rateBasisPoints: 0, netPence: earnings, taxPence: 0, totalPence: earnings, vatNumber: null, invoiceNotice: null,
      verification: null, evidence: buyerCountry ? [{ source: 'billing-address', country: buyerCountry, observedAt: paidAt }] : [],
      store: 'paddle',
      buyer: { country: buyerCountry, currency: t.details.totals.currency_code, totalMinor: minorUnits(t.details.totals.total), taxMinor: minorUnits(t.details.totals.tax) },
      storeFeeMinor: minorUnits(payout.fee),
      checkoutReference: order.reference,
      providerCheckoutId: transactionId,
      providerTransactionId: transactionId,
      accountId: order.accountId,
      status: 'paid',
      supplyDate,
      paidAt,
      retainThrough: String(Number(supplyDate.slice(0, 4)) + 10) + '-12-31',
      invoiceNumber: order.invoiceNumber,
    });
    if (sale.status !== 'paid' || sale.accountId !== order.accountId) return 'pending';
    await licences.grantLicence(purchaseEntitlement({
      store: 'paddle', checkoutReference: order.reference, accountId: order.accountId,
      emailHash: order.emailHash, majorVersion: order.majorVersion,
    }, Date.parse(paidAt)));
    return 'paid';
  };
}

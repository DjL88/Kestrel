import { purchaseEntitlement } from '../entitlement.ts';
import type { Store } from '../store.ts';
import type { CommerceLedger } from './ledger.ts';
import type { TransactionRecord } from './records.ts';
import type { sumupCheckouts } from './sumup.ts';

/** Server-owned order created from an approved quote and bound to a verified account. */
export interface ProPurchaseOrder {
  reference: string;
  accountId: string;
  emailHash: string;
  majorVersion: number;
  invoiceNumber: string;
  quote: Omit<TransactionRecord, 'checkoutReference' | 'providerCheckoutId' | 'providerTransactionId'
    | 'accountId' | 'status' | 'supplyDate' | 'paidAt' | 'retainThrough' | 'invoiceNumber'>;
}

interface Dependencies {
  findOrder: (checkoutId: string) => Promise<ProPurchaseOrder | null>;
  checkouts: Pick<ReturnType<typeof sumupCheckouts>, 'verifyPayment'>;
  commerce: Pick<CommerceLedger, 'recordPaid'>;
  licences: Pick<Store, 'getAccount' | 'grantLicence'>;
}

/** Reconcile by checkout ID. Retry safely if payment was written before the entitlement. */
export function sumupProSettlement({ findOrder, checkouts, commerce, licences }: Dependencies) {
  return async (checkoutId: string): Promise<void> => {
    const order = await findOrder(checkoutId);
    if (!order) return;

    const account = await licences.getAccount(order.accountId);
    if (!account || account.emailHash !== order.emailHash) throw new Error('Pro payment has no matching account.');
    const payment = await checkouts.verifyPayment({ reference: order.reference, totalPence: order.quote.totalPence }, checkoutId);
    if (!payment) return;

    const licence = purchaseEntitlement({
      checkoutReference: order.reference, accountId: order.accountId,
      emailHash: order.emailHash, majorVersion: order.majorVersion,
    }, Date.parse(payment.paidAt));
    const supplyDate = payment.paidAt.slice(0, 10);
    const sale = await commerce.recordPaid({
      ...order.quote,
      checkoutReference: order.reference,
      providerCheckoutId: payment.checkoutId,
      providerTransactionId: payment.transactionId,
      accountId: order.accountId,
      status: 'paid',
      supplyDate,
      paidAt: payment.paidAt,
      retainThrough: String(Number(supplyDate.slice(0, 4)) + 10) + '-12-31',
      invoiceNumber: order.invoiceNumber,
    });
    if (sale.status === 'paid' && sale.accountId === order.accountId) await licences.grantLicence(licence);
  };
}

import type { quoteProTax, TaxSettings, TaxTreatment } from './tax.ts';
import type { ukTurnoverMetrics } from './turnover.ts';

export const commerceCollections = {
  settings: 'tax_settings',
  transactions: 'transactions',
  turnover: 'rolling_turnover_metrics',
} as const;

export interface TaxSettingsRecord extends TaxSettings {
  updatedAt: string;
  updatedBy: string;
}

/**
 * Where a purchase was paid. Each is a merchant of record (it sells to the buyer and handles their tax), and each grants
 * the same account-wide entitlement, so Pro bought through any of them unlocks every device the person signs in on.
 * Only Paddle (desktop and web) is built; Apple and Google in-app purchase come with the phone apps.
 */
export const PURCHASE_STORES = ['paddle', 'apple', 'google'] as const;
export type PurchaseStore = typeof PURCHASE_STORES[number];

/**
 * 'merchant-of-record': the store sold to the buyer and accounted for their tax; InFlight's own sale is to the store
 * (Paddle.com Market Ltd is a UK company), for the amount the store pays out. Older SumUp-era treatments stay readable.
 */
type Sale = Omit<ReturnType<typeof quoteProTax>, 'currency' | 'treatment'> & {
  currency: string;
  treatment: TaxTreatment | 'merchant-of-record';
};

export interface TransactionRecord extends Sale {
  // Use the checkout reference as the document ID to make webhook retries idempotent.
  checkoutReference: string;
  providerCheckoutId: string;
  providerTransactionId: string;
  accountId: string | null;
  status: 'paid' | 'refunded' | 'partially-refunded';
  supplyDate: string;
  paidAt: string;
  // OSS records must survive ten years from the end of the year of sale.
  retainThrough: string;
  invoiceNumber: string;
  /** Set for merchant-of-record sales. */
  store?: PurchaseStore;
  /** What the buyer paid the store, in the buyer's currency (lowest unit), and the store's fee from our payout. */
  buyer?: { country: string | null; currency: string; totalMinor: number; taxMinor: number };
  storeFeeMinor?: number;
}

export type RollingTurnoverRecord = ReturnType<typeof ukTurnoverMetrics> & {
  updatedAt: string;
};

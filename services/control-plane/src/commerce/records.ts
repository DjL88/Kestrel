import type { quoteProTax, TaxSettings } from './tax.ts';
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

type Sale = ReturnType<typeof quoteProTax>;

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
}

export type RollingTurnoverRecord = ReturnType<typeof ukTurnoverMetrics> & {
  updatedAt: string;
};

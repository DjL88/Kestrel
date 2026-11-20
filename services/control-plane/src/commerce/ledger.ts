import type { Firestore } from '@google-cloud/firestore';
import { commerceCollections, type RollingTurnoverRecord, type TransactionRecord } from './records.ts';
import { ukTurnoverMetrics } from './turnover.ts';

export class CommerceLedger {
  constructor(private readonly db: Firestore) {}

  /**
   * Called only after the server retrieves and matches the paid checkout from SumUp.
   * A replay returns the original record, including its invoice number.
   */
  async recordPaid(sale: TransactionRecord): Promise<TransactionRecord> {
    if (sale.status !== 'paid' || !/^[A-Za-z0-9_-]{1,64}$/.test(sale.checkoutReference)) {
      throw new Error('Invalid verified sale.');
    }
    const document = this.db.collection(commerceCollections.transactions).doc(sale.checkoutReference);
    return this.db.runTransaction(async transaction => {
      const existing = (await transaction.get(document)).data() as TransactionRecord | undefined;
      if (existing) {
        if (existing.providerCheckoutId !== sale.providerCheckoutId
          || existing.providerTransactionId !== sale.providerTransactionId || existing.totalPence !== sale.totalPence) {
          throw new Error('The checkout reference already identifies a different payment.');
        }
        return existing;
      }
      transaction.create(document, sale);
      return sale;
    });
  }

  async recordTurnover(asOf: string, forecast?: Parameters<typeof ukTurnoverMetrics>[2]): Promise<RollingTurnoverRecord> {
    const priorYear = String(Number(asOf.slice(0, 4)) - 1);
    // The latest closed month can start its calculation before today's rolling window.
    const rows = await this.db.collection(commerceCollections.transactions)
      .where('country', '==', 'GB')
      .where('supplyDate', '>=', priorYear + '-01-01')
      .where('supplyDate', '<=', asOf)
      .get();
    const entries = rows.docs.map(document => document.data() as TransactionRecord)
      .map(record => ({ country: record.country, supplyDate: record.supplyDate, netPence: record.netPence }));
    const result = { ...ukTurnoverMetrics(entries, asOf, forecast), updatedAt: new Date().toISOString() };
    await this.db.collection(commerceCollections.turnover).doc(asOf).set(result);
    return result;
  }
}

export function summariseOssSales(sales: readonly TransactionRecord[], year: number, quarter: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 9998 || ![1, 2, 3, 4].includes(quarter)) {
    throw new Error('Invalid OSS quarter.');
  }
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, quarter * 3, 1)).toISOString().slice(0, 10);
  const grouped = new Map<string, { country: string; rateBasisPoints: number; netPence: number; taxPence: number }>();
  for (const sale of sales) {
    if (sale.treatment !== 'eu-oss' || sale.supplyDate < start || sale.supplyDate >= end) continue;
    const key = sale.country + '-' + sale.rateBasisPoints;
    const row = grouped.get(key) ?? { country: sale.country, rateBasisPoints: sale.rateBasisPoints, netPence: 0, taxPence: 0 };
    row.netPence += sale.netPence;
    row.taxPence += sale.taxPence;
    grouped.set(key, row);
  }
  return [...grouped.values()].sort((a, b) => a.country.localeCompare(b.country) || a.rateBasisPoints - b.rateBasisPoints);
}

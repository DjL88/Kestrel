import type { Firestore } from '@google-cloud/firestore';
import { commerceCollections, type RollingTurnoverRecord, type TaxSettingsRecord, type TransactionRecord } from './records.ts';
import { validateUkVatSettings, type TaxSettings } from './tax.ts';
import { ukTurnoverMetrics } from './turnover.ts';

export class CommerceLedger {
  constructor(private readonly db: Firestore) {}

  async getTaxSettings(): Promise<TaxSettings> {
    const settings = await this.db.collection(commerceCollections.settings).doc('current').get();
    return settings.exists
      ? settings.data() as TaxSettingsRecord
      : { ukVatRegistered: false, b2cPricing: 'exclusive', localTaxes: {} };
  }

  /** The authenticated admin's identity comes from the validated server session. */
  async updateTaxSettings(settings: TaxSettings, adminAccountId: string): Promise<void> {
    const updatedAt = new Date().toISOString();
    const ukVatNumber = settings.ukVatNumber?.replace(/\s/g, '').toUpperCase();
    const record: TaxSettingsRecord = {
      ukVatRegistered: settings.ukVatRegistered,
      b2cPricing: settings.b2cPricing,
      localTaxes: settings.localTaxes,
      ...(ukVatNumber ? { ukVatNumber } : {}),
      updatedAt,
      updatedBy: adminAccountId,
    };
    validateUkVatSettings(record);
    for (const [jurisdiction, rate] of Object.entries(record.localTaxes)) {
      if (!/^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/.test(jurisdiction)
        || !Number.isInteger(rate.rateBasisPoints) || rate.rateBasisPoints < 0 || rate.rateBasisPoints > 10000) {
        throw new Error('Invalid local tax setting.');
      }
    }
    await this.db.collection(commerceCollections.settings).doc('current').set(record);
  }

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

  /** Newest first, for the admin console. */
  async listTransactions(limit: number): Promise<TransactionRecord[]> {
    const rows = await this.db.collection(commerceCollections.transactions).orderBy('paidAt', 'desc').limit(limit).get();
    return rows.docs.map(document => document.data() as TransactionRecord);
  }

  async ossQuarter(year: number, quarter: number) {
    const { start, end } = quarterDates(year, quarter);
    const rows = await this.db.collection(commerceCollections.transactions)
      .where('supplyDate', '>=', start).where('supplyDate', '<', end).get();
    return summariseOssSales(rows.docs.map(document => document.data() as TransactionRecord), year, quarter);
  }

  async recordTurnover(asOf: string, forecast?: Parameters<typeof ukTurnoverMetrics>[2]): Promise<RollingTurnoverRecord> {
    const priorYear = String(Number(asOf.slice(0, 4)) - 1);
    // The latest closed month can start its calculation before today's rolling window.
    const rows = await this.db.collection(commerceCollections.transactions)
      .where('supplyDate', '>=', priorYear + '-01-01')
      .where('supplyDate', '<=', asOf)
      .get();
    const entries = rows.docs.map(document => document.data() as TransactionRecord)
      .filter(record => record.country === 'GB')
      .map(record => ({ country: record.country, supplyDate: record.supplyDate, netPence: record.netPence }));
    const result = { ...ukTurnoverMetrics(entries, asOf, forecast), updatedAt: new Date().toISOString() };
    await this.db.collection(commerceCollections.turnover).doc(asOf).set(result);
    return result;
  }
}

function quarterDates(year: number, quarter: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 9998 || ![1, 2, 3, 4].includes(quarter)) {
    throw new Error('Invalid OSS quarter.');
  }
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, quarter * 3, 1)).toISOString().slice(0, 10);
  return { start, end };
}

export function summariseOssSales(sales: readonly TransactionRecord[], year: number, quarter: number) {
  const { start, end } = quarterDates(year, quarter);
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

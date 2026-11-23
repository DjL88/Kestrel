/**
 * Hard monthly ceiling on metered spend (Gemini calls, cloud processing jobs). Owner approved £20 on 22 Nov 2026; the
 * default metered ceiling is £15, leaving headroom for fixed costs such as storage. Each call reserves its ESTIMATED cost
 * in pence before any money is spent and gets it back if the work did not happen. Estimates are placeholders, not Google's
 * bill: the Google Cloud budget alert and the billing console remain the truth. This is a brake, not an invoice.
 */
import type { FirestoreLike } from './firestoreStore.ts';

export const monthKey = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 7);
export const firestoreSpendRef = (db: FirestoreLike, nowMs: number) => db.collection('spend_ledger').doc(monthKey(nowMs));

export interface SpendGuard {
  /** Atomically adds `pence` to this month's total if it stays within the ceiling. */
  reserve(nowMs: number, pence: number, ceilingPence: number): Promise<boolean>;
  refund(nowMs: number, pence: number): Promise<void>;
  spent(nowMs: number): Promise<number>;
}
export interface SpendOptions { guard: SpendGuard; ceilingPence: number; cloudJobPence: number; aiCallPence: number }

export class MemorySpendGuard implements SpendGuard {
  private months = new Map<string, number>();
  async reserve(nowMs: number, pence: number, ceiling: number) { const k = monthKey(nowMs); const cur = this.months.get(k) ?? 0; if (cur + pence > ceiling) return false; this.months.set(k, cur + pence); return true; }
  async refund(nowMs: number, pence: number) { const k = monthKey(nowMs); this.months.set(k, Math.max((this.months.get(k) ?? 0) - pence, 0)); }
  async spent(nowMs: number) { return this.months.get(monthKey(nowMs)) ?? 0; }
}

/** `spend_ledger/{YYYY-MM}`: one running total per month, changed only inside a transaction. */
export class FirestoreSpendGuard implements SpendGuard {
  constructor(private readonly db: FirestoreLike) {}
  private ref(nowMs: number) { return firestoreSpendRef(this.db, nowMs); }
  async reserve(nowMs: number, pence: number, ceiling: number) {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref(nowMs));
      const cur = snap.exists ? Number(snap.data()!.pence ?? 0) : 0;
      if (cur + pence > ceiling) return false;
      tx.set(this.ref(nowMs), { month: monthKey(nowMs), pence: cur + pence });
      return true;
    });
  }
  async refund(nowMs: number, pence: number) {
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref(nowMs));
      if (snap.exists) tx.update(this.ref(nowMs), { pence: Math.max(Number(snap.data()!.pence ?? 0) - pence, 0) });
    });
  }
  async spent(nowMs: number) { const s = await this.ref(nowMs).get(); return s.exists ? Number(s.data()!.pence ?? 0) : 0; }
}

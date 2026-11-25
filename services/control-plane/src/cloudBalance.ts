/**
 * Prepaid cloud balance (owner pricing, 25 Nov 2026; price list in src/core/cloudPlan.ts). Everything beyond the free
 * monthly allowances (cloud photos, downloads, storage) is paid from here. Held in millicredits (1 credit = 1p =
 * 1000 millicredits) so a small preview download is charged exactly, not rounded to a penny.
 *
 * Every change is keyed: the same key is applied once, so a retried top-up webhook or a retried refund never counts
 * twice. A debit that would take the balance below zero is refused: cloud work then pauses, and nothing is ever deleted.
 */
import type { FirestoreLike } from './firestoreStore.ts';
import { docId } from './firestoreStore.ts';

export interface CloudBalance {
  millicredits(accountId: string): Promise<number>;
  /** Takes `amount` if the balance covers it. True when taken now or already taken under this key. */
  debit(accountId: string, amount: number, key: string): Promise<boolean>;
  /** Adds `amount` (a top-up, a refund, an admin grant). Applied once per key. */
  credit(accountId: string, amount: number, key: string): Promise<void>;
}

const whole = (n: number) => (Number.isSafeInteger(n) && n > 0 ? n : 0);

export class MemoryCloudBalance implements CloudBalance {
  private balances = new Map<string, number>();
  private applied = new Set<string>();
  async millicredits(accountId: string) { return this.balances.get(accountId) ?? 0; }
  async debit(accountId: string, amount: number, key: string) {
    const k = `${accountId}|${key}`;
    if (this.applied.has(k)) return true;
    const cur = this.balances.get(accountId) ?? 0, a = whole(amount);
    if (a > cur) return false;
    this.balances.set(accountId, cur - a); this.applied.add(k);
    return true;
  }
  async credit(accountId: string, amount: number, key: string) {
    const k = `${accountId}|${key}`;
    if (this.applied.has(k)) return;
    this.balances.set(accountId, (this.balances.get(accountId) ?? 0) + whole(amount)); this.applied.add(k);
  }
}

/** `cloud_balance/{account}` holds the balance; `cloud_balance_changes/{account|key}` records each applied change. */
export class FirestoreCloudBalance implements CloudBalance {
  constructor(private readonly db: FirestoreLike) {}
  private ref(accountId: string) { return this.db.collection('cloud_balance').doc(docId(accountId)); }
  private change(accountId: string, key: string) { return this.db.collection('cloud_balance_changes').doc(docId(accountId, key)); }
  async millicredits(accountId: string) {
    const snap = await this.ref(accountId).get();
    return snap.exists ? Number((snap.data() as { millicredits?: unknown }).millicredits ?? 0) || 0 : 0;
  }
  private apply(accountId: string, delta: number, key: string) {
    return this.db.runTransaction(async (tx) => {
      const changeRef = this.change(accountId, key);
      if ((await tx.get(changeRef)).exists) return true;
      const snap = await tx.get(this.ref(accountId));
      const cur = snap.exists ? Number((snap.data() as { millicredits?: unknown }).millicredits ?? 0) || 0 : 0;
      if (cur + delta < 0) return false;
      tx.set(this.ref(accountId), { accountId, millicredits: cur + delta });
      tx.set(changeRef, { accountId, key, delta, atMs: Date.now() });
      return true;
    });
  }
  async debit(accountId: string, amount: number, key: string) { return this.apply(accountId, -whole(amount), key); }
  async credit(accountId: string, amount: number, key: string) { await this.apply(accountId, whole(amount), key); }
}

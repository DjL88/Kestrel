/**
 * Per-account monthly download meter (cloud photo store, #1387). Every byte a cloud photo download hands out is costed
 * in credits (1 credit = 1p) and reserved against the account that pays for it, before the signed URL is issued. For a
 * shared project that is the project's owner, so friends' downloads come out of the owner's allowance. The allowance is
 * a policy object so the credit system being designed (top-ups, weekly or monthly resets) can plug in without touching
 * the routes. Amounts are held in millicredits so small previews are counted, not rounded away.
 */
import type { FirestoreLike } from './firestoreStore.ts';
import { monthKey } from './spendGuard.ts';

/** About 9.5p/GB to serve, sold at 33 credits (33p incl. VAT) per GB downloaded: at least 60% margin after VAT and Paddle fees. Same price as PAYG_PENCE.downloadPerGb in src/core/cloudPlan.ts. */
export const CREDITS_PER_GB_DOWNLOADED = 33;
export const millicreditsForBytes = (bytes: number) => Math.ceil(Math.max(0, bytes) * CREDITS_PER_GB_DOWNLOADED / 1_000_000);

export interface AllowancePolicy {
  /** Millicredits this account may spend on downloads this month. */
  monthlyMillicredits(accountId: string, nowMs: number): Promise<number>;
}
/** One flat allowance for everyone until credits exist. */
export class FlatAllowance implements AllowancePolicy {
  constructor(private readonly millicredits: number) {}
  async monthlyMillicredits() { return this.millicredits; }
}

export interface UsageRecord { month: string; millicredits: number; bytes: number; downloads: number }

export interface UsageMeter {
  /** Atomically adds the cost if it stays within `allowance`. */
  reserve(accountId: string, nowMs: number, bytes: number, allowance: number): Promise<boolean>;
  usage(accountId: string, nowMs: number): Promise<UsageRecord>;
}

const empty = (nowMs: number): UsageRecord => ({ month: monthKey(nowMs), millicredits: 0, bytes: 0, downloads: 0 });

export class MemoryUsageMeter implements UsageMeter {
  private rows = new Map<string, UsageRecord>();
  async reserve(accountId: string, nowMs: number, bytes: number, allowance: number) {
    const key = `${accountId}|${monthKey(nowMs)}`;
    const cur = this.rows.get(key) ?? empty(nowMs);
    const cost = millicreditsForBytes(bytes);
    if (cur.millicredits + cost > allowance) return false;
    this.rows.set(key, { ...cur, millicredits: cur.millicredits + cost, bytes: cur.bytes + bytes, downloads: cur.downloads + 1 });
    return true;
  }
  async usage(accountId: string, nowMs: number) { return { ...(this.rows.get(`${accountId}|${monthKey(nowMs)}`) ?? empty(nowMs)) }; }
}

/** `usage_ledger/{account}_{YYYY-MM}`, changed only inside a transaction. */
export class FirestoreUsageMeter implements UsageMeter {
  constructor(private readonly db: FirestoreLike) {}
  private ref(accountId: string, nowMs: number) { return this.db.collection('usage_ledger').doc(`${accountId}_${monthKey(nowMs)}`); }
  async reserve(accountId: string, nowMs: number, bytes: number, allowance: number) {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref(accountId, nowMs));
      const cur = snap.exists ? { ...empty(nowMs), ...(snap.data() as unknown as UsageRecord) } : empty(nowMs);
      const cost = millicreditsForBytes(bytes);
      if (cur.millicredits + cost > allowance) return false;
      tx.set(this.ref(accountId, nowMs), { accountId, month: cur.month, millicredits: cur.millicredits + cost, bytes: cur.bytes + bytes, downloads: cur.downloads + 1 });
      return true;
    });
  }
  async usage(accountId: string, nowMs: number) {
    const snap = await this.ref(accountId, nowMs).get();
    return snap.exists ? { ...empty(nowMs), ...(snap.data() as unknown as UsageRecord) } : empty(nowMs);
  }
}

/**
 * Downloads within the month's free allowance go to `inner`; beyond it, each download is paid from the prepaid cloud
 * balance at the same price (and still recorded in the month's usage). Refused only when the balance cannot cover it.
 */
export class BalanceBackedMeter implements UsageMeter {
  constructor(private readonly inner: UsageMeter, private readonly balance: import('./cloudBalance.ts').CloudBalance, private readonly key: () => string) {}
  async reserve(accountId: string, nowMs: number, bytes: number, allowance: number) {
    if (await this.inner.reserve(accountId, nowMs, bytes, allowance)) return true;
    if (!(await this.balance.debit(accountId, millicreditsForBytes(bytes), `download:${this.key()}`))) return false;
    await this.inner.reserve(accountId, nowMs, bytes, Number.MAX_SAFE_INTEGER);
    return true;
  }
  usage(accountId: string, nowMs: number) { return this.inner.usage(accountId, nowMs); }
}

/**
 * Storage billing for the cloud photo store (owner pricing, 25 Nov 2026; price list in src/core/cloudPlan.ts).
 * Each account pays for the projects it owns first (the same payer as downloads). Pro includes 2.5 GB and Basic none
 * (owner, 25 Nov 2026); beyond that 7p per GB a month, charged a day at a time (7p / 30 per GB per day) from the prepaid balance, keyed by day so a
 * retried or repeated settlement never charges twice.
 *
 * Nothing is ever deleted for want of credit: an unpaid day only means new uploads beyond the free amount are refused
 * until a top-up. Photos already stored stay readable and downloadable.
 */
import type { CloudBalance } from './cloudBalance.ts';

/** Storage included with each plan, as in src/core/cloudPlan.ts. */
export const FREE_STORAGE_BYTES = { basic: 0, pro: 2_500_000_000 } as const;
export const freeStorageFor = (pro: boolean) => (pro ? FREE_STORAGE_BYTES.pro : FREE_STORAGE_BYTES.basic);
/** 7p per GB-month = 7,000 millicredits per GB over 30 days. */
export const STORAGE_MILLICREDITS_PER_GB_MONTH = 7_000;
const GB = 1_000_000_000;
const DAY_MS = 86_400_000;

export const dayKey = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/** Millicredits for one day of `storedBytes`, rounded up. Zero within the free amount. */
export function dailyStorageMillicredits(storedBytes: number, freeBytes: number): number {
  const extra = Math.max(0, storedBytes - freeBytes);
  return Math.ceil((extra / GB) * STORAGE_MILLICREDITS_PER_GB_MONTH / 30);
}

/** What 30 more days of `storedBytes` would cost: the balance needed before an upload beyond the free amount. */
export function monthAheadMillicredits(storedBytes: number, freeBytes: number): number {
  return dailyStorageMillicredits(storedBytes, freeBytes) * 30;
}

export type SettleResult = 'free' | 'charged' | 'unpaid';

/** Charge today's storage for one account. Idempotent per account and day. */
export async function settleStorageDay(balance: CloudBalance, accountId: string, storedBytes: number, freeBytes: number, nowMs: number): Promise<SettleResult> {
  const cost = dailyStorageMillicredits(storedBytes, freeBytes);
  if (cost === 0) return 'free';
  return (await balance.debit(accountId, cost, `storage:${dayKey(nowMs)}`)) ? 'charged' : 'unpaid';
}

/** At most this many missed days are charged when an account is next seen (about two months). */
export const MAX_CATCH_UP_DAYS = 62;

/**
 * The days still to charge, oldest first: every day after `lastSettledDay` up to and including today, at most
 * `MAX_CATCH_UP_DAYS`. With nothing settled yet, only today. No daily scheduler is needed: the control plane settles
 * whenever the account's storage is looked at or changed (usage, upload), and any days in between are charged then at
 * the stored amount, which only changes through those same routes.
 */
export function daysToSettle(lastSettledDay: string | undefined, nowMs: number): string[] {
  const today = dayKey(nowMs);
  const last = lastSettledDay && /^\d{4}-\d{2}-\d{2}$/.test(lastSettledDay) ? Date.parse(`${lastSettledDay}T00:00:00Z`) : NaN;
  if (!Number.isFinite(last)) return [today];
  const days: string[] = [];
  for (let t = Date.parse(`${today}T00:00:00Z`); t > last && days.length < MAX_CATCH_UP_DAYS; t -= DAY_MS) days.push(dayKey(t));
  return days.reverse();
}

/** Charge each day in `days` (idempotent per day). 'unpaid' if any day could not be paid. */
export async function settleStorageDays(balance: CloudBalance, accountId: string, storedBytes: number, freeBytes: number, days: readonly string[]): Promise<SettleResult> {
  const cost = dailyStorageMillicredits(storedBytes, freeBytes);
  if (cost === 0) return 'free';
  let result: SettleResult = 'charged';
  for (const day of days) if (!(await balance.debit(accountId, cost, `storage:${day}`))) result = 'unpaid';
  return result;
}

/**
 * May this upload go ahead? Within the free amount always; beyond it only with a month of storage in the balance.
 * A server without a balance (development) keeps only the per-project size cap.
 */
export async function storageAllowsUpload(balance: CloudBalance | undefined, accountId: string, storedBytes: number, addBytes: number, freeBytes: number): Promise<boolean> {
  const after = storedBytes + Math.max(0, addBytes);
  if (after <= freeBytes || !balance) return true;
  return (await balance.millicredits(accountId)) >= monthAheadMillicredits(after, freeBytes);
}

export { DAY_MS };

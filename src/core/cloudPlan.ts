/**
 * InFlight plans and cloud allowances (owner decision, 25 November 2026). One shared contract for the app, the website
 * and the control plane. Pure: no network, no clock, no storage. This module DISPLAYS and ESTIMATES; the control plane
 * must still meter and authorise every cloud request itself (see spendGuard.ts).
 *
 * Software: Basic is free. Pro is £29 once for the current major version, or £2.99 a month that becomes ownership of the
 * latest major version after 12 successfully paid months.
 *
 * Cloud, the same for everyone who signs in:
 *  - cloud processing: a monthly photo allowance (Basic 500, Pro 5,000), then paid from the cloud balance;
 *  - storage: 2.5 GB free, then pay per GB-month;
 *  - downloads (other devices, collaborators, galleries, restores): 1 GB a month free, then pay per GB.
 * Prices include VAT and are set so each line keeps at least 60% margin after VAT, Paddle fees and Google's London list
 * prices (see CLOUD_COST_PENCE and the margin test). Running out never blocks local editing and never deletes files:
 * cloud work pauses until the next month or a top-up.
 */

export type SoftwarePlan = 'basic' | 'pro';

export const SOFTWARE_PRICES = {
  /** Pro, current major version, kept forever. */
  proOneOffPence: 2900,
  /** Pro, rent to own. */
  proMonthlyPence: 299,
  /** Successfully paid months that turn rent into ownership of the latest major version. */
  rentToOwnPayments: 12,
} as const;

/** Cloud photos included each calendar month (UTC). */
export const MONTHLY_PHOTO_ALLOWANCE: Record<SoftwarePlan, number> = { basic: 500, pro: 5000 };

const GB = 1_000_000_000;
export const FREE_STORAGE_BYTES = 2.5 * GB;
export const FREE_DOWNLOAD_BYTES_PER_MONTH = 1 * GB;

/** Pay-as-you-go prices, pence including VAT. */
export const PAYG_PENCE = {
  /** Each GB stored above the free amount, per month. */
  storagePerGbMonth: 7,
  /** Each GB downloaded above the free amount. */
  downloadPerGb: 33,
  /** Each cloud photo processed above the monthly allowance. */
  extraPhotoTenths: 3, // 0.3p a photo, £3 per 1,000
} as const;

/** Top-up amounts offered, pence. £5 is the minimum because Paddle charges 50p on every payment. */
export const TOP_UP_PENCE = [500, 1000, 2000] as const;

/**
 * What one unit costs us on Google Cloud in London (US$ list price at £0.79), pence. Used only to check margins.
 * Processing assumes about 6 s on the 4 vCPU / 8 GiB runner and a small preview or recipe coming back; a full-size
 * result is a download and is charged as one.
 */
export const CLOUD_COST_PENCE = { storagePerGbMonth: 1.82, downloadPerGb: 9.5, photo: 0.08 } as const;

/** Share of a top-up we keep after VAT (UK/EU/US/other mix) and Paddle's 5% + 50p, for the smallest (£5) top-up. */
export const KEEP_RATIO_SMALLEST_TOP_UP = 0.72;

export function marginOf(pricePence: number, costPence: number, keepRatio = KEEP_RATIO_SMALLEST_TOP_UP): number {
  const kept = pricePence * keepRatio;
  return kept > 0 ? (kept - costPence) / kept : 0;
}

const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Start of the next allowance month (1st of the next calendar month, UTC). */
export function nextResetMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export interface RentToOwn {
  owned: boolean;
  paymentsMade: number;
  paymentsLeft: number;
}

/** Only successful, non-refunded, consecutive payments count; the server decides which those are. */
export function rentToOwn(successfulPayments: number): RentToOwn {
  const made = whole(successfulPayments);
  const need = SOFTWARE_PRICES.rentToOwnPayments;
  return { owned: made >= need, paymentsMade: Math.min(made, need), paymentsLeft: Math.max(0, need - made) };
}

export interface CloudUsage {
  plan: SoftwarePlan;
  /** Cloud photos processed this month. */
  photosUsed: number;
  /** Bytes stored now. Absent when the server does not report it yet: the storage meter is then left out. */
  storedBytes?: number;
  /** Bytes downloaded this month. */
  downloadedBytes: number;
  /** Prepaid cloud balance, pence. */
  balancePence: number;
  nowMs: number;
}

export interface UsageMeter {
  id: 'photos' | 'storage' | 'downloads';
  used: number;
  included: number;
  /** 0–100 of the included amount, capped at 100. */
  percent: number;
  /** Pence this line will take from the balance this month at the current rate. */
  chargePence: number;
}

export interface UsageSummary {
  meters: UsageMeter[];
  resetsAtMs: number;
  /** Total pence this month beyond the free allowances, rounded up. */
  chargePence: number;
  /** Balance once this month's charges are taken. Never below zero: work pauses instead. */
  balanceAfterPence: number;
  /** True when this month's charges are more than the balance: new cloud work pauses until a top-up or reset. */
  paused: boolean;
}

function meter(id: UsageMeter['id'], used: number, included: number, chargePence: number): UsageMeter {
  const u = whole(used);
  return { id, used: u, included, percent: included > 0 ? Math.min(100, Math.round((u / included) * 100)) : 100, chargePence };
}

export function usageSummary(usage: CloudUsage): UsageSummary {
  const allowance = MONTHLY_PHOTO_ALLOWANCE[usage.plan] ?? MONTHLY_PHOTO_ALLOWANCE.basic;
  const extraPhotos = Math.max(0, whole(usage.photosUsed) - allowance);
  const extraStoredGb = Math.max(0, whole(usage.storedBytes ?? 0) - FREE_STORAGE_BYTES) / GB;
  const extraDownGb = Math.max(0, whole(usage.downloadedBytes) - FREE_DOWNLOAD_BYTES_PER_MONTH) / GB;
  const photoCharge = (extraPhotos * PAYG_PENCE.extraPhotoTenths) / 10;
  const storageCharge = extraStoredGb * PAYG_PENCE.storagePerGbMonth;
  const downloadCharge = extraDownGb * PAYG_PENCE.downloadPerGb;
  const meters = [
    meter('photos', usage.photosUsed, allowance, photoCharge),
    ...(usage.storedBytes === undefined ? [] : [meter('storage', usage.storedBytes, FREE_STORAGE_BYTES, storageCharge)]),
    meter('downloads', usage.downloadedBytes, FREE_DOWNLOAD_BYTES_PER_MONTH, downloadCharge),
  ];
  const charge = Math.ceil(photoCharge + storageCharge + downloadCharge);
  const balance = whole(usage.balancePence);
  return {
    meters,
    resetsAtMs: nextResetMs(usage.nowMs),
    chargePence: charge,
    balanceAfterPence: Math.max(0, balance - charge),
    paused: charge > balance,
  };
}

export interface TaskEstimate {
  photos: number;
  /** Photos covered by this month's allowance. */
  fromAllowance: number;
  /** Photos that would be paid from the balance. */
  paidPhotos: number;
  /** Allowance photos left this month once this task has run. */
  allowanceLeftAfter: number;
  pence: number;
  /** False when the balance cannot cover the paid photos: the task runs on this device instead. */
  canRunInCloud: boolean;
}

/** What a cloud task in the Task Manager will use, before it starts. */
export function estimateCloudTask(photos: number, usage: Pick<CloudUsage, 'plan' | 'photosUsed' | 'balancePence'>): TaskEstimate {
  const n = whole(photos);
  const allowance = MONTHLY_PHOTO_ALLOWANCE[usage.plan] ?? MONTHLY_PHOTO_ALLOWANCE.basic;
  const left = Math.max(0, allowance - whole(usage.photosUsed));
  const fromAllowance = Math.min(n, left);
  const paidPhotos = n - fromAllowance;
  const pence = Math.ceil((paidPhotos * PAYG_PENCE.extraPhotoTenths) / 10);
  return { photos: n, fromAllowance, paidPhotos, allowanceLeftAfter: left - fromAllowance, pence, canRunInCloud: pence <= whole(usage.balancePence) };
}

export function formatPence(pence: number): string {
  return `£${(whole(pence) / 100).toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  const b = whole(bytes);
  return b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round(b / 1_000_000)} MB`;
}

/** The control plane's `/v1/me/usage` answer as the Account panel's usage, or null when it lacks the plan fields. */
export function usageFromServer(body: { plan?: string; photosUsed?: number; bytes?: number; balanceCredits?: number; storedBytes?: number }, nowMs: number): CloudUsage | null {
  if (body.plan !== 'basic' && body.plan !== 'pro') return null;
  return {
    plan: body.plan, photosUsed: whole(body.photosUsed ?? 0), downloadedBytes: whole(body.bytes ?? 0),
    balancePence: Math.floor((Number.isFinite(body.balanceCredits) ? body.balanceCredits! : 0)),
    ...(typeof body.storedBytes === 'number' ? { storedBytes: whole(body.storedBytes) } : {}),
    nowMs,
  };
}

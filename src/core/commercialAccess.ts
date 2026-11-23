/**
 * InFlight's local-first commercial policy. This module only returns UI
 * capabilities; it is NEVER proof of cloud entitlement or permission.
 * Cloud APIs must independently enforce every request server-side.
 */
import { CLOUD_READ_ONLY_DAYS_V2 } from './subscriptionLifecyclePolicy';

export type LicenceState = 'active' | 'trial' | 'unverified' | 'unlicensed';
export type CloudState = 'active' | 'past_due' | 'cancelled' | 'none';
/** User-visible product tiers: Basic and lifetime Pro only. */
export type ProductPlan = 'free' | 'paid';
/** Historical subscriber records remain readable for migration/recovery; never issue new subscriber licences. */
export type Plan = ProductPlan | 'subscriber';

export interface AccessSnapshot {
  /** Explicit product tier from a verified signed entitlement. Defaults to legacy state for migration. */
  plan?: Plan;
  licence: LicenceState;
  cloud: CloudState;
  online: boolean;
  /** A previously verified local paid licence, not an arbitrary stored flag. */
  cachedLocalLicence: boolean;
  /** Server-confirmed capacity, not a local or user-selectable amount. */
  cloudQuotaBytes?: number;
  /** End of the paid cloud period, issued by the subscription authority (epoch ms). */
  cloudPaidThroughMs?: number;
  /** Time supplied by caller. Server access decisions must use SERVER time instead. */
  nowMs?: number;
}

export interface Capabilities {
  /** Basic editing is free. Paid tools are a separate capability. */
  localEditing: boolean;
  fullEditor: boolean;
  localProjectAccess: true;
  localBackups: true;
  /** Users must always be able to export their local work, regardless of licence. */
  localDataExport: true;
  cloudUploads: boolean;
  cloudDownloads: boolean;
  /** Online AI requests (consent and quotas are enforced elsewhere). */
  cloudAi: boolean;
  cloudQuotaBytes: number | null;
  /** If known, last time cloud data may be retrieved under retention policy. */
  cloudReadOnlyUntilMs: number | null;
  requiresLicenceVerification: boolean;
}

/** UI-only V2 cloud read-only window. No automatic cloud deletion is authorised. */
export const CLOUD_READ_ONLY_DAYS = CLOUD_READ_ONLY_DAYS_V2;
const DAY_MS = 24 * 60 * 60 * 1000;

function validTime(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A stopped V2 cloud subscription stays downloadable for 90 days from the
 * verified paid-through date. This display policy never authorises deletion.
 * Remote deletion needs prior notice and explicit owner approval, independently
 * implemented and enforced by the backend.
 *
 * No locally stored files or edits are ever deleted by this policy.
 */
export function accessCapabilities(snapshot: AccessSnapshot): Capabilities {
  const paidVerified = snapshot.licence === 'active' ||
    (snapshot.licence === 'unverified' && snapshot.cachedLocalLicence);
  // Historical snapshots without an explicit plan may recover local editor access,
  // but can NEVER claim cloud permissions without verified subscription evidence.
  const tier: Plan = snapshot.plan ?? (paidVerified ? 'paid' : 'free');
  const fullEditor = paidVerified && tier !== 'free';
  const now = validTime(snapshot.nowMs) ? snapshot.nowMs : null;
  const paidThrough = validTime(snapshot.cloudPaidThroughMs) ? snapshot.cloudPaidThroughMs : null;
  const readOnlyUntil = paidThrough === null ? null : paidThrough + CLOUD_READ_ONLY_DAYS * DAY_MS;
  const retentionValid = readOnlyUntil !== null && Number.isSafeInteger(readOnlyUntil);
  const withinRetention = now !== null && retentionValid && now <= readOnlyUntil;
  const eligibleSubscription = tier === 'subscriber' && fullEditor;

  // A legacy/plan-less record, even one saying "active", can never
  // self-assert a cloud grant. The backend must supply a verified plan,
  // paid-through timestamp and independent server-side authorisation.
  const currentlyPaid = snapshot.cloud === 'active' &&
    paidThrough !== null && now !== null && now <= paidThrough;
  const upload = snapshot.online && fullEditor && eligibleSubscription && currentlyPaid;
  const quotaValid = typeof snapshot.cloudQuotaBytes === 'number' &&
    Number.isSafeInteger(snapshot.cloudQuotaBytes) && snapshot.cloudQuotaBytes >= 0;
  // Reading previously uploaded data during the retention period must not
  // depend on a live editor licence. Subscription identity and account ownership
  // are still enforced on every server request.
  const readOnly = tier === 'subscriber' && snapshot.cloud !== 'none' && withinRetention;

  return {
    localEditing: true,
    fullEditor,
    localProjectAccess: true,
    localBackups: true,
    localDataExport: true,
    cloudUploads: upload && quotaValid,
    cloudDownloads: snapshot.online && (upload || readOnly),
    cloudAi: upload, // Provider consent and allowance still checked by the backend.
    cloudQuotaBytes: upload && quotaValid ? snapshot.cloudQuotaBytes! : null,
    cloudReadOnlyUntilMs: tier === 'subscriber' && retentionValid ? readOnlyUntil : null,
    requiresLicenceVerification: tier !== 'free' && snapshot.licence === 'unverified' && !snapshot.cachedLocalLicence,
  };
}

export interface PriceDisplay {
  localPence: number;
  currency: 'GBP';
}

/** UK price proposals, NOT payment/checkout authority. */
export const PROPOSED_UK_PRICES: Readonly<PriceDisplay> = Object.freeze({
  localPence: 2900,
  currency: 'GBP',
});

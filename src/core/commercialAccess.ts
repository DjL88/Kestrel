/**
 * Kestrel's local-first commercial policy. This module only returns UI
 * capabilities; it is NEVER proof of cloud entitlement or permission.
 * Cloud APIs must independently enforce every request server-side.
 */
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

export const CLOUD_READ_ONLY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function validTime(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A stopped cloud subscription is read-only for 365 days after the last paid
 * period. Downloads cease after that date, but remote deletion is a SEPARATE
 * scheduled backend action requiring prior notice and an export route.
 *
 * No locally stored files or edits are ever deleted by this policy.
 */
export function accessCapabilities(snapshot: AccessSnapshot): Capabilities {
  const paidVerified = snapshot.licence === 'active' ||
    (snapshot.licence === 'unverified' && snapshot.cachedLocalLicence);
  // Backwards-compatible legacy snapshot without a plan.
  const tier: Plan = snapshot.plan ?? (paidVerified ? 'paid' : 'free');
  const fullEditor = paidVerified && tier !== 'free';
  const now = validTime(snapshot.nowMs) ? snapshot.nowMs : null;
  const paidThrough = validTime(snapshot.cloudPaidThroughMs) ? snapshot.cloudPaidThroughMs : null;
  const readOnlyUntil = paidThrough === null ? null : paidThrough + CLOUD_READ_ONLY_DAYS * DAY_MS;
  const retentionValid = readOnlyUntil !== null && Number.isSafeInteger(readOnlyUntil);
  const withinRetention = now !== null && retentionValid && now <= readOnlyUntil;
  const eligibleSubscription = tier === 'subscriber' && fullEditor;

  // Only historical subscriber records have a paid-through cloud period.
  // Basic and one-off Pro have no monthly tier; optional BYO storage is separate.
  const legacy = snapshot.plan === undefined;
  const currentlyPaid = legacy
    ? snapshot.cloud === 'active'
    : snapshot.cloud === 'active' && paidThrough !== null && now !== null && now <= paidThrough;
  const upload = snapshot.online && fullEditor && (legacy || eligibleSubscription) && currentlyPaid;
  const quotaValid = typeof snapshot.cloudQuotaBytes === 'number' &&
    Number.isSafeInteger(snapshot.cloudQuotaBytes) && snapshot.cloudQuotaBytes >= 0;
  const readOnly = eligibleSubscription && snapshot.cloud !== 'none' && withinRetention;

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
    cloudReadOnlyUntilMs: eligibleSubscription && retentionValid ? readOnlyUntil : null,
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

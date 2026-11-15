/**
 * Kestrel commercial capability policy.
 *
 * No purchase state is allowed to modify or remove a user's local catalogue.
 * Billing and identity providers remain out of this pure boundary.
 */
export type LicenceState = 'active' | 'trial' | 'unverified' | 'unlicensed';
export type CloudState = 'active' | 'past_due' | 'cancelled' | 'none';

export interface AccessSnapshot {
  licence: LicenceState;
  cloud: CloudState;
  /** Whether this device can reach the entitlement service. */
  online: boolean;
  /** Previously verified local licence. Never substitute a new claim for verification. */
  cachedLocalLicence: boolean;
  /** Future cloud capacity in bytes as asserted by the server. No server = no quota claim. */
  cloudQuotaBytes?: number;
}

export interface Capabilities {
  localEditing: boolean;
  localProjectAccess: true;
  localBackups: true;
  cloudUploads: boolean;
  cloudDownloads: boolean;
  cloudQuotaBytes: number | null;
  requiresLicenceVerification: boolean;
}

/**
 * Preview/trial access is limited to the editor; local project recovery, export
 * of user-owned data, and backup access must never depend on a network licence.
 *
 * The server will authoritatively validate any cloud operation and paid licence.
 * Client capabilities are UI hints, never proof of payment or permission.
 */
export function accessCapabilities(snapshot: AccessSnapshot): Capabilities {
  const purchased = snapshot.licence === 'active' ||
    (snapshot.licence === 'unverified' && snapshot.cachedLocalLicence);
  const localEditing = purchased || snapshot.licence === 'trial';
  const cloudActive = snapshot.online && snapshot.cloud === 'active' && purchased;
  const validQuota = typeof snapshot.cloudQuotaBytes === 'number'
    && Number.isSafeInteger(snapshot.cloudQuotaBytes) && snapshot.cloudQuotaBytes >= 0;
  return {
    localEditing,
    localProjectAccess: true,
    localBackups: true,
    cloudUploads: cloudActive && validQuota,
    // A cancelled or past-due subscription may need a grace-period download
    // policy, but that must be enforced by the server and is not assumed here.
    cloudDownloads: cloudActive,
    cloudQuotaBytes: cloudActive && validQuota ? snapshot.cloudQuotaBytes! : null,
    requiresLicenceVerification: snapshot.licence === 'unverified' && !snapshot.cachedLocalLicence,
  };
}

export interface PriceDisplay {
  localPence: number;
  cloudMonthlyPence: number;
  currency: 'GBP';
}

/** Proposed UK launch prices, not a live price authority or checkout contract. */
export const PROPOSED_UK_PRICES: Readonly<PriceDisplay> = Object.freeze({
  localPence: 2900,
  cloudMonthlyPence: 299,
  currency: 'GBP',
});

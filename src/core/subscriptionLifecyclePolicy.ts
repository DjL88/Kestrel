/**
 * Proposed InFlight subscription lifecycle contract, NOT a server entitlement.
 * No checkout, storage, account or deletion integration is performed here.
 * The backend must verify billing events and use its own trusted clock.
 */
export const PAYMENT_RETRY_GRACE_DAYS = 21;
export const CLOUD_READ_ONLY_DAYS_V2 = 90;
const DAY_MS = 86_400_000;

export type SubscriptionPhase = 'unknown' | 'paid' | 'retry_grace' | 'downgraded';

export interface SubscriptionLifecycle {
  phase: SubscriptionPhase;
  cloudUploadsAllowed: boolean;
  cloudReadOnlyDownloadsAllowed: boolean;
  /** Display deadline only; NEVER a deletion trigger. */
  cloudReadOnlyUntilMs: number | null;
  /** Remote deletion always requires separate notice and explicit owner approval. */
  remoteDeletionAuthorised: false;
  localEditingAllowed: true;
  localRecoveryAllowed: true;
  localExportAllowed: true;
}

/**
 * UI policy derived from a verified paid-through timestamp. An unverified,
 * absent, negative or unsafe timestamp grants no cloud access.
 * This function does not confer permission on cloud APIs.
 */
export function subscriptionLifecycle(
  paidThroughMs: number | null,
  nowMs: number,
): SubscriptionLifecycle {
  const valid = (value: number | null): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const known = valid(paidThroughMs) && valid(nowMs);
  const retryUntil = known ? paidThroughMs + PAYMENT_RETRY_GRACE_DAYS * DAY_MS : null;
  const readOnlyUntil = known ? paidThroughMs + CLOUD_READ_ONLY_DAYS_V2 * DAY_MS : null;
  const safe = known && Number.isSafeInteger(retryUntil) && Number.isSafeInteger(readOnlyUntil);
  const paid = safe && nowMs <= paidThroughMs;
  const retry = safe && !paid && nowMs <= retryUntil;
  const readable = safe && nowMs <= readOnlyUntil;
  return {
    phase: !safe ? 'unknown' : paid ? 'paid' : retry ? 'retry_grace' : 'downgraded',
    cloudUploadsAllowed: paid,
    cloudReadOnlyDownloadsAllowed: readable,
    cloudReadOnlyUntilMs: safe ? readOnlyUntil : null,
    remoteDeletionAuthorised: false,
    localEditingAllowed: true,
    localRecoveryAllowed: true,
    localExportAllowed: true,
  };
}

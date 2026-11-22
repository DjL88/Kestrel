import { sha256Hex } from './crypto.ts';
import { newLicence, type LicenceRecord, type LicencePlan } from './store.ts';

/**
 * Entitlements: who has which plan, for which major version, whether money was received, and whether managed AI is
 * included. They are keyed by the person (their email, hashed) and need no signing key and no typed key.
 *
 * The id is derived, never random, so granting twice is harmless: a payment webhook that arrives twice, or an admin who
 * double-clicks, ends up with one entitlement.
 */

export const normaliseEmail = (email: string) => email.trim().toLowerCase();
export const emailHashOf = (email: string) => sha256Hex(normaliseEmail(email));

export type PurchaseGrant = ({ email: string } | { emailHash: string }) & {
  /** The checkout reference of the verified payment: the idempotency key. */
  checkoutReference: string;
  majorVersion: number;
  managedAi?: boolean;
  accountId?: string | null;
};
export interface GiftGrant {
  email: string;
  plan: Exclude<LicencePlan, 'free'>;
  majorVersion: number;
  managedAi?: boolean;
  note?: string | null;
  validUntilMs?: number | null;
  accountId?: string | null;
}

const REFERENCE = /^[A-Za-z0-9_-]{1,64}$/;

/** A paid entitlement. Call this only after the payment has been retrieved from the provider and matched. */
export function purchaseEntitlement(grant: PurchaseGrant, nowMs: number): LicenceRecord {
  if (!REFERENCE.test(grant.checkoutReference)) throw new Error('Invalid checkout reference.');
  assertVersion(grant.majorVersion);
  const emailHash = 'emailHash' in grant ? grant.emailHash : emailHashOf(grant.email);
  if (!/^[a-f0-9]{64}$/.test(emailHash)) throw new Error('Invalid account email hash.');
  return newLicence(`lic_p_${grant.checkoutReference}`, 'paid', nowMs, {
    accountId: grant.accountId ?? null, emailHash, majorVersion: grant.majorVersion,
    paid: true, source: 'purchase', managedAi: grant.managedAi ?? false,
  });
}

/** A free grant. One per person per plan and major version, however many times the admin presses the button. */
export function giftEntitlement(grant: GiftGrant, nowMs: number): LicenceRecord {
  assertVersion(grant.majorVersion);
  const hash = emailHashOf(grant.email);
  return newLicence(`lic_g_${hash.slice(0, 24)}_${grant.plan}_v${grant.majorVersion}`, grant.plan, nowMs, {
    accountId: grant.accountId ?? null, emailHash: hash, majorVersion: grant.majorVersion, paid: false, source: 'gift',
    managedAi: grant.managedAi ?? false, note: grant.note ?? null, validUntilMs: grant.validUntilMs ?? null,
  });
}

/** Does this licence cover the running app? A licence for version 1 does not unlock version 2. */
export function coversVersion(licence: Pick<LicenceRecord, 'majorVersion'>, appMajorVersion: number): boolean {
  return licence.majorVersion >= appMajorVersion;
}

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > 99) throw new Error('Invalid major version.');
}

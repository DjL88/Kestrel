/**
 * Offline entitlement grants: what the control plane hands a device after a
 * licence is activated on it. The grant is an Ed25519 SignedEnvelope (see
 * signedEnvelope.ts) so the device can keep honouring it with no network.
 *
 * Rules that never change:
 * - Free local editing, project access, backup and export never depend on a grant.
 * - An expired online session never revokes a valid grant.
 * - A grant past its offline window drops paid tools back to Free; it never
 *   locks, hides or deletes local work.
 */
import type { AccessSnapshot, Plan } from './commercialAccess';
import { openEnvelope, type PinnedKeys } from './signedEnvelope';

export interface EntitlementGrant {
  schema: 1;
  grantId: string;
  plan: Plan;
  /** Whether the managed AI gateway may be offered. The server still checks every request. */
  managedAi: boolean;
  /** SHA-256 hex of the device fingerprint the grant was issued to. */
  deviceHash: string;
  issuedAtMs: number;
  /** After this, paid tools need one successful online check. */
  offlineUntilMs: number;
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const PLANS: readonly Plan[] = ['free', 'paid', 'subscriber'];
const FIELDS = ['schema', 'grantId', 'plan', 'managedAi', 'deviceHash', 'issuedAtMs', 'offlineUntilMs'];
/** Longest offline window a client will accept, whatever a grant claims. */
export const MAX_OFFLINE_DAYS = 90;
const DAY_MS = 86_400_000;

export function parseEntitlementGrant(input: unknown): EntitlementGrant | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const g = input as Record<string, unknown>;
  if (Object.keys(g).length !== FIELDS.length || !FIELDS.every((key) => Object.hasOwn(g, key))) return null;
  if (g.schema !== 1 || typeof g.grantId !== 'string' || !ID.test(g.grantId) ||
      !PLANS.includes(g.plan as Plan) || typeof g.managedAi !== 'boolean' ||
      typeof g.deviceHash !== 'string' || !HEX64.test(g.deviceHash) ||
      !Number.isSafeInteger(g.issuedAtMs) || !Number.isSafeInteger(g.offlineUntilMs)) return null;
  const issued = g.issuedAtMs as number, until = g.offlineUntilMs as number;
  if (issued < 0 || until <= issued || until - issued > MAX_OFFLINE_DAYS * DAY_MS) return null;
  return {
    schema: 1, grantId: g.grantId, plan: g.plan as Plan, managedAi: g.managedAi,
    deviceHash: g.deviceHash, issuedAtMs: issued, offlineUntilMs: until,
  };
}

export type GrantCheck =
  | { ok: true; grant: EntitlementGrant }
  | { ok: false; reason: 'malformed' | 'unknown_key' | 'bad_signature' | 'other_device' };

/** Verify a stored grant against the pinned keys and this device. Never throws. */
export async function verifyEntitlementGrant(
  envelope: unknown, keys: PinnedKeys, deviceHash: string,
): Promise<GrantCheck> {
  const opened = await openEnvelope(envelope, keys);
  if ('failure' in opened) return { ok: false, reason: opened.failure };
  const grant = parseEntitlementGrant(opened.payload);
  if (!grant) return { ok: false, reason: 'malformed' };
  if (grant.deviceHash !== deviceHash) return { ok: false, reason: 'other_device' };
  return { ok: true, grant };
}

/**
 * The access snapshot a verified grant supports at `nowMs`. `null` (no grant, or
 * one that failed verification) is Free. Online session state is deliberately
 * not an input: losing a session must not take anything away.
 */
export function snapshotFromGrant(grant: EntitlementGrant | null, nowMs: number, online: boolean): AccessSnapshot {
  if (!grant || grant.plan === 'free') {
    return { plan: 'free', licence: 'unlicensed', cloud: 'none', online, cachedLocalLicence: false, nowMs };
  }
  // Offline, the device clock is all there is. Past the window, paid tools wait for one online check.
  const withinWindow = Number.isSafeInteger(nowMs) && nowMs <= grant.offlineUntilMs;
  return {
    plan: grant.plan,
    licence: withinWindow ? 'active' : 'unverified',
    cloud: 'none',
    online,
    cachedLocalLicence: withinWindow,
    nowMs,
  };
}

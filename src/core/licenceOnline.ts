/**
 * The online half of a Kestrel licence, as pure rules. The offline half is `licence.ts`: a KESTREL1 key whose signature
 * checks out unlocks Pro with no account and no connection, for good. Going online adds three things:
 * - a device slot and an Ed25519-signed offline grant (`entitlementGrant.ts`) from the control plane, renewed while online;
 * - the managed AI allowance, which only a grant can turn on;
 * - hearing about a revoked key. A key the server says is revoked or expired stops unlocking Pro on this device.
 *
 * Nothing here ever locks, hides or deletes local work: Free editing, projects, backup and export never depend on it.
 */
import type { EntitlementGrant } from './entitlementGrant';
import type { PinnedKeys } from './signedEnvelope';

const DAY_MS = 86_400_000;
/** Renew a grant this old, even if it is far from lapsing, so a revocation is heard within a week of being online. */
export const RENEW_AFTER_MS = 7 * DAY_MS;
/** Also renew when the offline window has this little left. */
export const RENEW_BEFORE_END_MS = 7 * DAY_MS;

export type KestrelPlatform = 'windows' | 'macos' | 'web' | 'ios' | 'android';

/** What the control plane last said about this key on this device. */
export type OnlineStanding =
  | { kind: 'not_set_up' }                 // this build has no control plane address or pinned grant key
  | { kind: 'not_checked' }                // set up, but not reached yet
  | { kind: 'active'; grant: EntitlementGrant; activationId: string }
  | { kind: 'device_limit'; message: string }
  | { kind: 'revoked'; message: string }   // revoked or expired on the server
  | { kind: 'unreachable'; grant: EntitlementGrant | null; activationId: string | null };

/** Parse "id=base64,id2=base64" (a build setting) into pinned keys. Anything malformed is left out. */
export function parsePinnedKeys(text: string | undefined): PinnedKeys {
  const keys: Record<string, string> = {};
  for (const pair of (text ?? '').split(',')) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const id = pair.slice(0, at).trim(), key = pair.slice(at + 1).trim();
    if (/^[A-Za-z0-9._-]{1,64}$/.test(id) && /^[A-Za-z0-9+/]{43}=$/.test(key)) keys[id] = key;
  }
  return keys;
}

/** An https address (or http on this computer, for development) with no path tricks; otherwise null. */
export function parseControlPlaneUrl(text: string | undefined): string | null {
  if (!text) return null;
  try {
    const url = new URL(text.trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch { return null; }
}

/** Should the app ask the server again now? */
export function renewalDue(grant: EntitlementGrant | null, nowMs: number): boolean {
  if (!grant) return true;
  return nowMs - grant.issuedAtMs >= RENEW_AFTER_MS || grant.offlineUntilMs - nowMs <= RENEW_BEFORE_END_MS;
}

export function platformOf(desktopShell: boolean, userAgent: string): KestrelPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return desktopShell ? 'ios' : 'web';
  if (/Android/i.test(userAgent)) return desktopShell ? 'android' : 'web';
  if (!desktopShell) return 'web';
  return /Mac/i.test(userAgent) ? 'macos' : 'windows';
}

export interface AccessDecision {
  pro: boolean;
  /** The online helper may be offered (the server still checks every request). */
  managedAi: boolean;
  /** Why, in one word, for the Licence screen. */
  basis: 'grant' | 'key' | 'revoked' | 'none';
}

/**
 * Pro on this device, from the key (checked offline) and what the server last said.
 * - A verified grant inside its offline window: Pro, with the managed AI flag it carries.
 * - Otherwise a valid key: Pro, offline, as promised (no account, no connection needed).
 * - The server said the key is revoked or expired: not Pro, whatever the key says. Free stays fully usable.
 */
export function decideAccess(keyValid: boolean, standing: OnlineStanding, nowMs: number): AccessDecision {
  if (!keyValid) return { pro: false, managedAi: false, basis: 'none' };
  if (standing.kind === 'revoked') return { pro: false, managedAi: false, basis: 'revoked' };
  const grant = standing.kind === 'active' ? standing.grant : standing.kind === 'unreachable' ? standing.grant : null;
  if (grant && grant.plan !== 'free' && nowMs <= grant.offlineUntilMs) return { pro: true, managedAi: grant.managedAi, basis: 'grant' };
  return { pro: true, managedAi: false, basis: 'key' };
}

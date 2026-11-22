/**
 * Who is asking, and which flags apply: the pure glue between the verified entitlement grant, the signed public flags
 * document and the evaluator in featureFlags.ts. Nothing here fetches or stores anything.
 */
import type { EntitlementGrant } from './entitlementGrant';
import { flagSetFromGrant, type Audience, type FlagSet } from './featureFlags';

/** A grant counts only inside its signed offline window, the same rule that decides whether Pro is on. */
export const grantInForce = (grant: EntitlementGrant | null | undefined, nowMs: number): grant is EntitlementGrant =>
  !!grant && nowMs <= grant.offlineUntilMs;

/**
 * Pro when a paid grant is in force, Basic when the person is signed in or holds a free grant, otherwise Unknown
 * (nobody has told the app who they are). `signedIn` is a hint kept on the device, never an email.
 */
export function audienceFor(grant: EntitlementGrant | null | undefined, nowMs: number, signedIn: boolean): Audience {
  if (grantInForce(grant, nowMs) && grant.plan !== 'free') return { plan: 'pro' };
  if (signedIn || grantInForce(grant, nowMs)) return { plan: 'basic' };
  return { plan: 'unknown' };
}

/**
 * The public document applies to everyone. Flags resolved for this person in a grant that is in force replace the public
 * rule for the same key. A grant past its window adds nothing, so the app falls back to the public document, then to
 * the compiled defaults.
 */
export function assembleFlags(publicFlags: FlagSet | undefined, grant: EntitlementGrant | null | undefined, nowMs: number): FlagSet {
  const fromGrant = grantInForce(grant, nowMs) ? flagSetFromGrant(grant.flags, nowMs) : {};
  return { ...(publicFlags ?? {}), ...fromGrant };
}

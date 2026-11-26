import { grantIsOwned, type EntitlementGrant } from './entitlementGrant';

/**
 * What the Account settings say about this device's plan, all the time, from the licence store's current state
 * (not from the last "Check Pro online" answer). Pro only when the store's verified access says so, as useIsPro does.
 */
export type LicencePlan =
  | { kind: 'checking' }
  | { kind: 'pro-account'; offlineUntilMs: number | null; owned: boolean }
  | { kind: 'pro-key' }
  | { kind: 'free' };

/** The parts of the licence store's state this needs, so it can be tested without the store. */
export type LicencePlanInput =
  | { status: 'none' | 'invalid' }
  | { status: 'checking' }
  | { status: 'valid'; access: { pro: boolean } }
  | { status: 'account'; access: { pro: boolean }; standing: { kind: string; grant?: Pick<EntitlementGrant, 'offlineUntilMs'> & Partial<Pick<EntitlementGrant, 'plan' | 'flags'>> } };

export function licencePlan(licence: LicencePlanInput): LicencePlan {
  if (licence.status === 'checking') return { kind: 'checking' };
  if (licence.status === 'valid' && licence.access.pro) return { kind: 'pro-key' };
  if (licence.status === 'account' && licence.access.pro) {
    const grant = licence.standing.kind === 'active' ? licence.standing.grant ?? null : null;
    const owned = !!grant && grantIsOwned(grant);
    // Bought outright has no offline deadline to show.
    return { kind: 'pro-account', offlineUntilMs: grant && !owned ? grant.offlineUntilMs : null, owned };
  }
  return { kind: 'free' };
}

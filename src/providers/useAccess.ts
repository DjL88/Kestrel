import { useMemo } from 'react';
import { useLicence } from './licenceStore';
import { accessCapabilities, type AccessSnapshot, type Capabilities } from '../core/commercialAccess';
import { featureAvailable, type Feature } from '../core/features';

/**
 * Beta: every feature is open, because there is no way to buy or verify a licence yet. When licence activation exists,
 * this is the one place that changes: it will read the cached signed entitlement instead of this fixed snapshot.
 * Free never needs an account, and local recovery and backup are never gated (see `commercialAccess.ts`).
 */
/** A build made with VITE_KESTREL_PLAN=free shows the Free experience, so it can be tested. Normal builds stay open. */
export const BETA_ALL_FEATURES_OPEN = import.meta.env.VITE_KESTREL_PLAN !== 'free';

export function currentSnapshot(licensed = false): AccessSnapshot {
  return BETA_ALL_FEATURES_OPEN || licensed
    ? { plan: 'paid', licence: 'active', cloud: 'none', online: false, cachedLocalLicence: true }
    : { plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false };
}

export function useAccess(): { capabilities: Capabilities; can: (feature: Feature) => boolean } {
  const licensed = useLicence().status === 'valid';
  return useMemo(() => {
    const capabilities = accessCapabilities(currentSnapshot(licensed));
    return { capabilities, can: (feature: Feature) => featureAvailable(feature, capabilities) };
  }, [licensed]);
}

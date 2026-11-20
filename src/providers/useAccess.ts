import { useMemo } from 'react';
import { useLicence } from './licenceStore';
import { accessCapabilities, type AccessSnapshot, type Capabilities } from '../core/commercialAccess';
import { featureAvailable, type Feature } from '../core/features';

/**
 * Beta: every feature is open. Otherwise Pro comes from the licence (licenceStore.ts and core/licenceOnline.ts): a valid
 * KESTREL1 key, or a verified offline grant from the control plane, unless the server has said the key is revoked.
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
  const licence = useLicence();
  const licensed = licence.status === 'valid' && licence.access.pro;
  return useMemo(() => {
    const capabilities = accessCapabilities(currentSnapshot(licensed));
    return { capabilities, can: (feature: Feature) => featureAvailable(feature, capabilities) };
  }, [licensed]);
}

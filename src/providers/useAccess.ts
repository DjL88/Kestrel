import { useMemo } from 'react';
import { useLicence } from './licenceStore';
import { accessCapabilities, type AccessSnapshot, type Capabilities } from '../core/commercialAccess';
import { featureAvailable, type Feature } from '../core/features';

/** Production builds never presume Pro: only a verified signed key or cached, verified grant grants Pro.
 * An explicit local dev-server preview flag may expose Pro tools to developers, never to installers.
 */
export const DEV_PRO_PREVIEW_MODE = import.meta.env.DEV && import.meta.env.VITE_KESTREL_DEV_PRO === '1';

export function currentSnapshot(licensed = false): AccessSnapshot {
  return DEV_PRO_PREVIEW_MODE || licensed
    ? { plan: 'paid', licence: 'active', cloud: 'none', online: false, cachedLocalLicence: true }
    : { plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false };
}

export function useAccess(): { capabilities: Capabilities; can: (feature: Feature) => boolean } {
  const licence = useLicence();
  const licensed = (licence.status === 'valid' || licence.status === 'account') && licence.access.pro;
  return useMemo(() => {
    const capabilities = accessCapabilities(currentSnapshot(licensed));
    return { capabilities, can: (feature: Feature) => featureAvailable(feature, capabilities) };
  }, [licensed]);
}

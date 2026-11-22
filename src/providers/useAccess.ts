import { useMemo } from 'react';
import { useLicence } from './licenceStore';
import { accessCapabilities, type AccessSnapshot, type Capabilities } from '../core/commercialAccess';
import { featureAvailable, type Feature } from '../core/features';
import type { EntitlementGrant } from '../core/entitlementGrant';
import { assembleFlags, audienceFor } from '../core/flagContext';
import { deviceBucket, signedInHint, usePublicFlags } from './featureFlagsStore';
import { version as appVersion } from '../../package.json';

/** Production builds never presume Pro: only a verified signed key or cached, verified grant grants Pro.
 * An explicit local dev-server preview flag may expose Pro tools to developers, never to installers.
 */
export const DEV_PRO_PREVIEW_MODE = import.meta.env.DEV && import.meta.env.VITE_KESTREL_DEV_PRO === '1';

export function currentSnapshot(licensed = false): AccessSnapshot {
  return DEV_PRO_PREVIEW_MODE || licensed
    ? { plan: 'paid', licence: 'active', cloud: 'none', online: false, cachedLocalLicence: true }
    : { plan: 'free', licence: 'unlicensed', cloud: 'none', online: false, cachedLocalLicence: false };
}

/** The verified grant behind the current licence state, if any. Flags travel only inside it. */
function grantOf(licence: ReturnType<typeof useLicence>): EntitlementGrant | null {
  const standing = licence.status === 'valid' ? licence.online : licence.status === 'account' ? licence.standing : null;
  return standing && 'grant' in standing ? standing.grant : null;
}

export function useAccess(): { capabilities: Capabilities; can: (feature: Feature) => boolean } {
  const licence = useLicence();
  const publicFlags = usePublicFlags();
  const licensed = (licence.status === 'valid' || licence.status === 'account') && licence.access.pro;
  const grant = grantOf(licence);
  return useMemo(() => {
    const capabilities = accessCapabilities(currentSnapshot(licensed));
    const signedIn = signedInHint();
    return {
      capabilities,
      can: (feature: Feature) => {
        const nowMs = Date.now();
        return featureAvailable(feature, capabilities, {
          flags: assembleFlags(publicFlags, grant, nowMs),
          audience: licensed ? { plan: 'pro' } : audienceFor(grant, nowMs, signedIn),
          nowMs, bucket: deviceBucket(), appVersion,
        });
      },
    };
  }, [licensed, grant, publicFlags]);
}

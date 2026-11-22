import { FEATURES, type Feature } from '../../core/features';
import type { FeatureKey } from '../ui/contract';

/** Every feature the V2 UI asks about. Each is a key in `src/core/features.ts`, so it goes through `featureAvailable`
 * (never a direct plan check) and can later be driven by the backend flags. Basic or Pro only, for now. */
export const V2_FEATURES = ['watermarkCustom', 'overlayText', 'smartCulling', 'speciesId', 'onlineAi', 'cloudAssist', 'zoomVideo', 'splitFrames'] as const satisfies readonly FeatureKey[] & readonly Feature[];

export function featurePlan(): Record<FeatureKey, 'basic' | 'pro'> {
  return Object.fromEntries(V2_FEATURES.map((key) => [key, FEATURES[key] === 'paid' ? 'pro' : 'basic'])) as Record<FeatureKey, 'basic' | 'pro'>;
}

/** The existing developer-only switch, as in `providers/useAccess.ts`: the Vite dev server with VITE_KESTREL_DEV_PRO=1. It is
 * never on in a build people install. (Read here without importing that module, which needs the Vite environment.) */
const DEV_PRO_PREVIEW_MODE = Boolean(import.meta.env?.DEV && import.meta.env?.VITE_KESTREL_DEV_PRO === '1');

export function featureAccess(can: (feature: Feature) => boolean, devPro: boolean = DEV_PRO_PREVIEW_MODE): Record<FeatureKey, boolean> {
  return Object.fromEntries(V2_FEATURES.map((key) => [key, devPro || can(key)])) as Record<FeatureKey, boolean>;
}

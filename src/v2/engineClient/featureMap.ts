import { FEATURES, type Feature } from '../../core/features';
import type { FeatureKey } from '../ui/contract';

/** Every feature the V2 UI asks about. Each is a key in `src/core/features.ts`, so it goes through `featureAvailable`
 * (never a direct plan check) and can later be driven by the backend flags. Basic or Pro only, for now. */
export const V2_FEATURES = ['watermarkCustom', 'overlayText', 'smartCulling', 'speciesId', 'onlineAi', 'cloudAssist', 'zoomVideo', 'splitFrames'] as const satisfies readonly FeatureKey[] & readonly Feature[];

export function featurePlan(): Record<FeatureKey, 'basic' | 'pro'> {
  return Object.fromEntries(V2_FEATURES.map((key) => [key, FEATURES[key] === 'paid' ? 'pro' : 'basic'])) as Record<FeatureKey, 'basic' | 'pro'>;
}

export function featureAccess(can: (feature: Feature) => boolean): Record<FeatureKey, boolean> {
  return Object.fromEntries(V2_FEATURES.map((key) => [key, can(key)])) as Record<FeatureKey, boolean>;
}

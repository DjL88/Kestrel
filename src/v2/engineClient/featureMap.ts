import { FEATURES, type Feature } from '../../core/features';
import type { FeatureKey } from '../ui/contract';

/** Every feature the V2 UI asks about. Each is a key in `src/core/features.ts`, so it goes through
 * `featureAvailable` and verified admin flags (never a direct plan check). */
export const V2_FEATURES = ['watermarkCustom', 'overlayText', 'smartCulling', 'speciesId', 'onlineAi', 'cloudAssist', 'zoomVideo', 'splitFrames', 'panorama'] as const satisfies readonly FeatureKey[] & readonly Feature[];

export function featurePlan(): Record<FeatureKey, 'basic' | 'pro'> {
  return Object.fromEntries(V2_FEATURES.map((key) => [key, FEATURES[key] === 'paid' ? 'pro' : 'basic'])) as Record<FeatureKey, 'basic' | 'pro'>;
}

/** This adapter never bypasses the Admin flag evaluator, including in developer builds. */
export function featureAccess(can: (feature: Feature) => boolean): Record<FeatureKey, boolean> {
  return Object.fromEntries(V2_FEATURES.map((key) => [key, can(key)])) as Record<FeatureKey, boolean>;
}

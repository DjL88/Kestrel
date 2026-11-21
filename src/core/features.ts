import type { Capabilities } from './commercialAccess';

/**
 * Every feature that differs between Free and Paid, in one list. The interface asks `featureAvailable`; it never
 * checks a plan itself. Moving a feature between Free and Paid is a one-word change here.
 *
 * Free: complete local photographic essentials, including truthful RAW/raster editing,
 * basic subject masks, subject detection, natural Auto, full-size output and backups.
 * Pro: advanced time-saving intelligence (species ID, assisted culling and online AI).
 * Image integrity, original access and export quality must never be paywalled.
 * Backup and recovery are always free and never counted.
 */
export const FEATURES = {
  import: 'free',
  basicEditing: 'free',
  cropAndStraighten: 'free',
  export: 'free',
  watermark: 'free',
  macroPad: 'free',
  localBackup: 'free',
  masks: 'free',
  subjectDetection: 'free',
  autoTab: 'free',
  speciesId: 'paid',
  onlineAi: 'paid',
  smartCulling: 'paid',
} as const;

export type Feature = keyof typeof FEATURES;
export const FEATURE_NAMES = Object.keys(FEATURES) as Feature[];

export function featureAvailable(feature: Feature, capabilities: Capabilities): boolean {
  return FEATURES[feature] === 'free' || capabilities.fullEditor;
}

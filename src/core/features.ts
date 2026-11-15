import type { Capabilities } from './commercialAccess';

/**
 * Every feature that differs between Free and Paid, in one list. The interface asks `featureAvailable`; it never
 * checks a plan itself. Moving a feature between Free and Paid is a one-word change here.
 *
 * Free: import, cull by hand, edit, export (with a daily allowance, below), all on this device only.
 * Paid: subject detection and masking, the Auto tab, species ID, any AI, and assisted culling.
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
  masks: 'paid',
  subjectDetection: 'paid',
  autoTab: 'paid',
  speciesId: 'paid',
  onlineAi: 'paid',
  smartCulling: 'paid',
  unlimitedExport: 'paid',
} as const;

export type Feature = keyof typeof FEATURES;
export const FEATURE_NAMES = Object.keys(FEATURES) as Feature[];

/** Photos a Free user can export per day. Paid is unlimited. A proposal: change it here. */
export const FREE_DAILY_EXPORT_LIMIT = 10;

export function featureAvailable(feature: Feature, capabilities: Capabilities): boolean {
  return FEATURES[feature] === 'free' || capabilities.fullEditor;
}

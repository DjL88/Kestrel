import type { Capabilities } from './commercialAccess';

/**
 * Every feature that can differ between Free and Paid, in one list. The interface asks `featureAvailable`; it never
 * checks a plan itself. Moving a feature between Free and Paid is a one-word change here.
 * Free keeps basic editing, local projects, backup and export, always.
 */
export const FEATURES = {
  basicEditing: 'free',
  cropAndStraighten: 'free',
  basicExport: 'free',
  localBackup: 'free',
  masks: 'paid',
  advancedEditing: 'paid',
  subjectDetection: 'paid',
  smartCulling: 'paid',
  batchExport: 'paid',
  watermark: 'paid',
  macroPad: 'paid',
} as const;

export type Feature = keyof typeof FEATURES;
export const FEATURE_NAMES = Object.keys(FEATURES) as Feature[];

export function featureAvailable(feature: Feature, capabilities: Capabilities): boolean {
  return FEATURES[feature] === 'free' || capabilities.fullEditor;
}

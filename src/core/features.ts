import type { Capabilities } from './commercialAccess';
import { evaluateFlag, type Audience, type Evaluation, type FlagSet } from './featureFlags';

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

/**
 * Features no flag can ever switch off: working with your own photos. Originals, ordinary export, local backup and basic
 * editing stay on whatever the control plane says, so a trial ending or a kill switch can never lock someone out of their work.
 */
export const NEVER_GATED: ReadonlySet<Feature> = new Set<Feature>(['import', 'basicEditing', 'cropAndStraighten', 'export', 'localBackup']);

/**
 * The flags this build ships with, derived from the table above. They apply whenever no verified rules have arrived
 * (offline, signed out, first run), and they equal today's behaviour exactly: free features on for everyone, paid
 * features on for Pro only.
 */
export const COMPILED_FLAGS: FlagSet = Object.fromEntries(FEATURE_NAMES.map((name) => [
  name,
  FEATURES[name] === 'free'
    ? { default: true, rules: [] }
    : { default: false, rules: [{ audience: { kind: 'plan' as const, plan: 'pro' as const }, enabled: true }] },
]));

export interface FeatureContext {
  /** Who is asking. Defaults to Pro when the editor is fully unlocked, otherwise Basic. */
  audience?: Audience;
  /** Verified rules from the last signed grant or public document. Missing means compiled defaults only. */
  flags?: FlagSet;
  nowMs?: number;
  bucket?: number;
  appVersion?: string;
}

export function evaluateFeature(feature: Feature, capabilities: Capabilities, context: FeatureContext = {}): Evaluation {
  const audience: Audience = context.audience ?? { plan: capabilities.fullEditor ? 'pro' : 'basic' };
  return evaluateFlag(feature, context.flags ?? {}, COMPILED_FLAGS, {
    audience, nowMs: context.nowMs ?? Date.now(), bucket: context.bucket, appVersion: context.appVersion, neverGated: NEVER_GATED,
  });
}

export function featureAvailable(feature: Feature, capabilities: Capabilities, context: FeatureContext = {}): boolean {
  return evaluateFeature(feature, capabilities, context).on;
}

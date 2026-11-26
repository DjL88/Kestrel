import type { Capabilities } from './commercialAccess';
import { evaluateFlag, type Audience, type Evaluation, type FlagSet } from './featureFlags';

/**
 * Every feature that differs between Free and Paid, in one list. The interface asks `featureAvailable`; it never
 * checks a plan itself. Moving a feature between Free and Paid is a one-word change here.
 *
 * Free: complete local photographic essentials, including truthful RAW/raster editing, subject masks, subject
 * detection, natural Auto, full-size output and backups, and every on-device model (culling, species ID and the
 * rest: owner decision 13, 25 Nov 2026). An admin flag can still restrict any of them without a code change.
 * Pro: the enhanced cloud models (online AI review, cloud processing).
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
  // On-device models are Basic (owner decision 13). Only the enhanced cloud models are Pro.
  speciesId: 'free',
  onlineAi: 'paid',
  smartCulling: 'free',
  // Text overlays and custom watermarks are Basic while the editor is being tested.
  // Advanced/online features remain Pro and are OFF until enabled in Firestore Admin flags.
  overlayText: 'free',
  watermarkCustom: 'free',
  cloudAssist: 'paid',
  zoomVideo: 'free',
  splitFrames: 'free',
  // Settings → Account "Download my data" and "Delete my account". Off for everyone until an admin flag turns it on
  // (the owner checks the wording first). Not a paid feature: once on, it is for every signed-in person.
  accountData: 'flagged',
  // Panorama stitching: a preview, off for everyone until an admin flag (or this device's preview switch) turns it on. Not a paywall.
  panorama: 'flagged',
} as const;

export type Feature = keyof typeof FEATURES;
export const FEATURE_NAMES = Object.keys(FEATURES) as Feature[];

/**
 * Features no flag can ever switch off: local essentials and Basic overlays. Originals, ordinary export, local backup,
 * editing, text overlays and watermarks stay on even if an old Firestore flag still calls overlays Pro.
 */
export const NEVER_GATED: ReadonlySet<Feature> = new Set<Feature>(['import', 'basicEditing', 'cropAndStraighten', 'export', 'localBackup', 'overlayText', 'watermarkCustom']);

/**
 * The flags this build ships with, derived from the table above. They apply whenever no verified rules have arrived
 * (offline, signed out, first run). Basic features work for everyone; Pro features stay OFF for *all*
 * plans until an administrator explicitly enables them using a signed Firestore feature flag.
 */
export const COMPILED_FLAGS: FlagSet = Object.fromEntries(FEATURE_NAMES.map((name) => [
  name,
  FEATURES[name] === 'free'
    ? { default: true, rules: [] }
    : { default: false, rules: [] },
]));

export interface FeatureContext {
  /** Who is asking. Defaults to Pro when the editor is fully unlocked, otherwise Basic. */
  audience?: Audience;
  /** Verified rules from the last signed grant or public document. Missing means compiled defaults only. */
  flags?: FlagSet;
  nowMs?: number;
  bucket?: number;
  appVersion?: string;
  /**
   * The developer-only Pro preview (`VITE_KESTREL_DEV_PRO=1` on the Vite dev server; `import.meta.env.DEV` is false in
   * every installed build). It opens every feature so Pro paths can be tested; compiled Pro flags are otherwise off.
   */
  devProPreview?: boolean;
}

export function evaluateFeature(feature: Feature, capabilities: Capabilities, context: FeatureContext = {}): Evaluation {
  const audience: Audience = context.audience ?? { plan: capabilities.fullEditor ? 'pro' : 'basic' };
  return evaluateFlag(feature, context.flags ?? {}, COMPILED_FLAGS, {
    audience, nowMs: context.nowMs ?? Date.now(), bucket: context.bucket, appVersion: context.appVersion, neverGated: NEVER_GATED,
  });
}

export function featureAvailable(feature: Feature, capabilities: Capabilities, context: FeatureContext = {}): boolean {
  if (context.devProPreview === true) return true;
  return evaluateFeature(feature, capabilities, context).on;
}

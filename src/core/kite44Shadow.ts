/**
 * Kite44 research contribution boundary. Pure, offline, no telemetry transport.
 * A backup subscription, an optional Cloud review and a training contribution are
 * different permissions. The most restrictive research permission always wins.
 *
 * The caller must obtain server-verified standing consent before uploading any
 * returned shadow records. This file NEVER sends data, creates IDs, or reads photos.
 */
export type Kite44Contribution = 'off' | 'shadow' | 'photos';
export type Kite44DecisionKind =
  | 'subject' | 'quality' | 'mask' | 'cull' | 'edit' | 'denoise' | 'colour';
export type Kite44Outcome = 'proposed' | 'accepted' | 'modified' | 'undone' | 'rejected' | 'unknown';

/** Undefined means no permission; project choice is mandatory even if account opted in. */
export interface Kite44ResearchPolicy {
  account: Kite44Contribution;
  project?: Kite44Contribution;
  photo?: Kite44Contribution;
  /** Cloud image access requires an independent per-photo consent mechanism. */
  photoAccessApproved?: boolean;
}

const RANK: Record<Kite44Contribution, number> = { off: 0, shadow: 1, photos: 2 };

export function effectiveKite44Permission(policy: Kite44ResearchPolicy): Kite44Contribution {
  const account = policy.account;
  const project = policy.project ?? 'off';
  const photo = policy.photo ?? project;
  if (!(account in RANK) || !(project in RANK) || !(photo in RANK)) return 'off';
  const level = Math.min(RANK[account], RANK[project], RANK[photo]);
  if (level === 2 && !policy.photoAccessApproved) return 'shadow';
  return level === 2 ? 'photos' : level === 1 ? 'shadow' : 'off';
}

const METRICS = [
  'eyeSharpness', 'subjectConfidence', 'exposureBalance',
  'highlightClipping', 'shadowClipping', 'noiseEstimate',
  'haloEstimate', 'maskCoverage', 'editQuality'
] as const;
export type Kite44Metric = typeof METRICS[number];

export interface Kite44Decision {
  kind: Kite44DecisionKind;
  modelFamily: 'Kite44' | 'external';
  /** A bounded version label, not free-text model output. */
  modelVersion: string;
  outcome: Kite44Outcome;
  /** Only numeric preapproved metrics; never pixels or embeddings. */
  metrics?: Partial<Record<Kite44Metric, number>>;
  /** Whitelisted slider deltas, not an arbitrary edit-recipe object. */
  adjustments?: Partial<Record<'exposure' | 'warmth' | 'contrast' | 'highlights' | 'shadows' | 'vibrance' | 'sharpen' | 'denoise', number>>;
}

export interface Kite44ShadowRecord {
  schemaVersion: 1;
  kind: Kite44DecisionKind;
  modelFamily: 'Kite44' | 'external';
  modelVersion: string;
  outcome: Kite44Outcome;
  metrics: Partial<Record<Kite44Metric, number>>;
  adjustments: Record<string, number>;
}

const KINDS = new Set<Kite44DecisionKind>(['subject', 'quality', 'mask', 'cull', 'edit', 'denoise', 'colour']);
const OUTCOMES = new Set<Kite44Outcome>(['proposed', 'accepted', 'modified', 'undone', 'rejected', 'unknown']);
const ADJUSTMENTS = ['exposure','warmth','contrast','highlights','shadows','vibrance','sharpen','denoise'] as const;
function bounded(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(Math.max(-2, Math.min(2, n)) * 1000) / 1000;
}

/**
 * Produces only a minimal anonymous-shaped event (not a proof of anonymity).
 * Account IDs, filenames, hashes, GPS, original dimensions, timestamps,
 * narrative AI responses, embeddings and all pixel content are forbidden.
 */
export function makeKite44ShadowRecord(policy: Kite44ResearchPolicy, decision: Kite44Decision): Kite44ShadowRecord | null {
  if (effectiveKite44Permission(policy) === 'off') return null;
  if (!KINDS.has(decision.kind) || !OUTCOMES.has(decision.outcome)) return null;
  if (decision.modelFamily !== 'Kite44' && decision.modelFamily !== 'external') return null;
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(decision.modelVersion)) return null;
  const metrics: Partial<Record<Kite44Metric, number>> = {};
  for (const key of METRICS) {
    const value = bounded(decision.metrics?.[key]);
    if (value !== undefined) metrics[key] = value;
  }
  const adjustments: Record<string, number> = {};
  for (const key of ADJUSTMENTS) {
    const value = bounded(decision.adjustments?.[key]);
    if (value !== undefined) adjustments[key] = value;
  }
  return {
    schemaVersion: 1, kind: decision.kind, modelFamily: decision.modelFamily,
    modelVersion: decision.modelVersion, outcome: decision.outcome,
    metrics, adjustments,
  };
}

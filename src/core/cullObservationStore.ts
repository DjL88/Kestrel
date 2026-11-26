import { judgePreview, scoreWithSubjects, type CullEvidence, type CullSuggestion, type PreviewMeasures, type SubjectFinding } from './autoCull';
import { finaliseCullEvidence } from './cullEvidenceFinal';
import type { CullingState, PhotoFrame } from './types';

/**
 * Stored cull observations (x-std-rescore). After a scan each photo keeps the raw numbers it was judged from: the
 * preview detail and clipping, every subject the detector reported (label, confidence, size, sharpness) and whether
 * it was a byte-identical copy. Its burst is the photo's own `burstGroupId`. A threshold or scorer change then judges
 * the whole project again from these numbers, with no new scan.
 *
 * An observation belongs to one version of one original and one detector build. A photo whose file, fingerprint or
 * detector changed, or a project from before this existed, has no current observation and is scanned once more.
 * Numbers only: never pixels, paths, picture data or a decision. Re-judging never changes `decision` by itself.
 */
export const CULL_OBSERVATION_VERSION = 1;
const MAX_SUBJECTS = 16;

export interface StoredCullObservation {
  v: typeof CULL_OBSERVATION_VERSION;
  /** The detector build the subjects came from, or 'none' when it did not run. */
  model: string;
  /** The original this was measured from. */
  stableKey: string;
  originalSha256?: string;
  /** When it was measured (epoch ms). */
  at: number;
  /** A byte-identical copy of an earlier photo. Its preview numbers are not needed. */
  duplicate?: true;
  preview?: PreviewMeasures;
  /** Every subject reported; null when the detector did not run or failed on this photo. */
  subjects: SubjectFinding[] | null;
}

const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readSubject(value: unknown): SubjectFinding | null {
  if (!record(value) || typeof value.label !== 'string' || value.label.length > 80 || !finite(value.score, 0, 1) ||
      !Number.isSafeInteger(value.size) || (value.size as number) <= 0 || !finite(value.sharpness, 0, 1_000_000)) return null;
  return { label: value.label, score: value.score, size: value.size as number, sharpness: value.sharpness };
}

/** A stored observation, checked as untrusted input (projects come back from disk and backups). Null when damaged. */
export function readCullObservation(value: unknown): StoredCullObservation | null {
  if (!record(value) || value.v !== CULL_OBSERVATION_VERSION || typeof value.model !== 'string' || !value.model ||
      value.model.length > 128 || typeof value.stableKey !== 'string' || !value.stableKey || !finite(value.at, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (value.originalSha256 !== undefined && (typeof value.originalSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.originalSha256))) return null;
  const duplicate = value.duplicate === true;
  let preview: PreviewMeasures | undefined;
  if (value.preview !== undefined) {
    const p = value.preview;
    if (!record(p) || !finite(p.detail, 0, 1_000_000) || !finite(p.dark, 0, 1) || !finite(p.bright, 0, 1) ||
        p.dark + p.bright > 1.000001) return null;
    preview = { detail: p.detail, dark: p.dark, bright: p.bright };
  }
  if (!duplicate && !preview) return null;
  let subjects: SubjectFinding[] | null = null;
  if (value.subjects !== null) {
    if (!Array.isArray(value.subjects) || value.subjects.length > MAX_SUBJECTS) return null;
    const read = value.subjects.map(readSubject);
    if (read.some((subject) => subject === null)) return null;
    subjects = read as SubjectFinding[];
  }
  return {
    v: CULL_OBSERVATION_VERSION, model: value.model, stableKey: value.stableKey, at: value.at,
    ...(typeof value.originalSha256 === 'string' ? { originalSha256: value.originalSha256 } : {}),
    ...(duplicate ? { duplicate: true as const } : {}), ...(preview ? { preview } : {}), subjects,
  };
}

/**
 * The photo's observation if it still describes this file and this detector. With a detector available, a photo
 * the detector never ran on counts as not observed, so it is looked at once more rather than judged without subjects.
 */
export function currentCullObservation(frame: Pick<PhotoFrame, 'stableKey' | 'originalSha256' | 'cullObservation'>,
  model: string, detectorAvailable: boolean): StoredCullObservation | null {
  const observation = readCullObservation(frame.cullObservation);
  if (!observation || observation.stableKey !== frame.stableKey || observation.originalSha256 !== frame.originalSha256) return null;
  if (observation.duplicate) return observation;
  if (detectorAvailable ? observation.subjects === null || observation.model !== model : observation.subjects !== null) return null;
  return observation;
}

/** What one scan saw, before the shoot-wide decisions: per-photo evidence and the byte-identical copies. */
export interface ScanEvidence {
  evidence: ReadonlyMap<string, CullEvidence>;
  duplicates: ReadonlySet<string>;
}

/**
 * Keep what the scan saw on each photo it looked at. Photos the scan could not read keep their old observation, if
 * any. A photo changed or replaced while the scan ran is left alone. Never touches `decision`.
 */
export function recordCullObservations(state: CullingState, examined: readonly PhotoFrame[], scan: ScanEvidence,
  model: string, detectorHealthy: boolean, at: number): CullingState {
  const before = new Map(examined.map((frame) => [frame.id, frame]));
  let changed = false;
  const frames = state.frames.map((frame) => {
    const seen = before.get(frame.id);
    if (!seen || seen.stableKey !== frame.stableKey || seen.originalSha256 !== frame.originalSha256) return frame;
    const found = scan.evidence.get(frame.id);
    const duplicate = scan.duplicates.has(frame.id);
    if (!duplicate && !found?.preview) return frame;
    const next = readCullObservation({
      v: CULL_OBSERVATION_VERSION, model: detectorHealthy && found?.subjects ? model : 'none',
      stableKey: frame.stableKey, originalSha256: frame.originalSha256, at,
      ...(duplicate ? { duplicate: true } : {}), ...(found?.preview ? { preview: found.preview } : {}),
      subjects: detectorHealthy && found?.subjects ? found.subjects.slice(0, MAX_SUBJECTS) : null,
    });
    if (!next) return frame;
    changed = true;
    return { ...frame, cullObservation: next };
  });
  return changed ? { ...state, frames } : state;
}

/**
 * Judge photos again from their stored observations, with today's thresholds and the same shoot-wide rules a scan
 * applies (copies, detector fallback, the "almost no subjects" fallback). `missing` lists the photos that need a scan.
 * The keeper budget is applied later, against the live catalogue, exactly as after a scan.
 */
export function rescoreFromObservations(frames: readonly PhotoFrame[], model: string, detectorAvailable: boolean):
  { results: CullSuggestion[]; missing: PhotoFrame[] } {
  const missing: PhotoFrame[] = [];
  const ids: string[] = [];
  const results = new Map<string, CullSuggestion>();
  const bases = new Map<string, CullSuggestion>();
  const duplicates = new Set<string>();
  let detectorHealthy = detectorAvailable;
  for (const frame of frames) {
    const observation = currentCullObservation(frame, model, detectorAvailable);
    if (!observation) { missing.push(frame); continue; }
    ids.push(frame.id);
    if (observation.duplicate) { duplicates.add(frame.id); continue; }
    const base = judgePreview(frame.id, observation.preview ?? null);
    bases.set(frame.id, base);
    if (observation.subjects === null) detectorHealthy = false;
    results.set(frame.id, observation.subjects === null ? base : scoreWithSubjects(base, observation.subjects));
  }
  // Re-judged suggestions carry no evidence: the stored observation already holds it.
  const strip = ({ evidence: _evidence, ...rest }: CullSuggestion): CullSuggestion => rest;
  return { results: finaliseCullEvidence(ids, results, duplicates, bases, detectorHealthy).map(strip), missing };
}

/** Evidence travels only as far as the store: suggestions handed on keep their usual shape. */
export function withoutEvidence(results: readonly CullSuggestion[]): CullSuggestion[] {
  return results.map(({ evidence: _evidence, ...rest }) => rest);
}

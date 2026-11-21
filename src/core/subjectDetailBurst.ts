/**
 * Kestrel Select: immutable on-device evidence -> subject-detail crop and
 * conservative burst comparison. This never changes catalogue decisions,
 * source pixels, or mask recipes. Detector scores are NOT calibrated odds.
 */
export type SubjectGenre = 'bird' | 'aircraft' | 'person' | 'pet' | 'sport' | 'macro' | 'landscape' | 'architecture' | 'travel' | 'unknown';
export interface NormalisedBox { x: number; y: number; width: number; height: number }
export interface SelectEvidence {
  photoId: string;
  sourceSha256: string;
  modelId: string;
  modelVersion: string;
  genre: SubjectGenre;
  /** Local detector scores, not probabilities. */
  birdScore?: number;
  aircraftScore?: number;
  subjectScore?: number;
  eyeSharpness?: number;
  subjectSharpness?: number;
  poseScore?: number;
  motionBlur?: number;
  duplicateGroup?: string;
  burstId?: string;
  subjectBox?: NormalisedBox;
  eyeBox?: NormalisedBox;
  manualDecision?: 'keep' | 'reject' | 'review';
}
export interface SelectResult {
  photoId: string;
  crop: NormalisedBox | null;
  recommendation: 'keep' | 'reject' | 'review';
  reason: 'manual' | 'uncertain' | 'conflict' | 'best-in-burst' | 'other-candidate';
  /** Relative comparison score only; not a probability or calibrated quality. */
  score: number | null;
  comparisonGroup: string | null;
}
const unit = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
const sha = (s: string) => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);
const box = (b: NormalisedBox | undefined): b is NormalisedBox =>
  !!b && unit(b.x) && unit(b.y) && unit(b.width) && unit(b.height) &&
  b.width > 0 && b.height > 0 && b.x + b.width <= 1.00000001 && b.y + b.height <= 1.00000001;
const cropAround = (b: NormalisedBox): NormalisedBox => {
  const side = Math.min(1, Math.max(0.08, Math.max(b.width, b.height) * 2.5));
  const x = Math.max(0, Math.min(1 - side, b.x + b.width / 2 - side / 2));
  const y = Math.max(0, Math.min(1 - side, b.y + b.height / 2 - side / 2));
  return { x, y, width: side, height: side };
};
const evidenceValid = (e: SelectEvidence) =>
  !!e.photoId?.trim() && sha(e.sourceSha256) && !!e.modelId?.trim() && !!e.modelVersion?.trim() &&
  ['bird','aircraft','person','pet','sport','macro','landscape','architecture','travel','unknown'].includes(e.genre) &&
  (e.subjectScore === undefined || unit(e.subjectScore)) &&
  (e.eyeSharpness === undefined || unit(e.eyeSharpness)) &&
  (e.subjectSharpness === undefined || unit(e.subjectSharpness)) &&
  (e.poseScore === undefined || unit(e.poseScore)) &&
  (e.motionBlur === undefined || unit(e.motionBlur)) &&
  (e.birdScore === undefined || unit(e.birdScore)) &&
  (e.aircraftScore === undefined || unit(e.aircraftScore)) &&
  (!e.subjectBox || box(e.subjectBox)) && (!e.eyeBox || box(e.eyeBox)) &&
  (e.burstId === undefined || !!e.burstId.trim()) &&
  (e.duplicateGroup === undefined || !!e.duplicateGroup.trim());
/** Scores require independent validation before use as a confident species label. */
function contradiction(e: SelectEvidence): boolean {
  if (e.genre !== 'bird' && e.genre !== 'aircraft') return false;
  // Without both detector heads we cannot rule out the known aircraft/bird confusion.
  if (!unit(e.birdScore) || !unit(e.aircraftScore)) return true;
  const intended = e.genre === 'bird' ? e.birdScore : e.aircraftScore;
  const other = e.genre === 'bird' ? e.aircraftScore : e.birdScore;
  return intended < 0.6 || other >= 0.55 || intended - other < 0.2;
}
function score(e: SelectEvidence): number | null {
  if (!unit(e.subjectSharpness) || !unit(e.motionBlur)) return null;
  const eye = e.genre === 'bird' || e.genre === 'person' || e.genre === 'pet';
  // Eye evidence improves ties only when present. Missing eye is never an automatic reject.
  const detail = eye && unit(e.eyeSharpness) ? (e.eyeSharpness * 0.25 + e.subjectSharpness * 0.75) : e.subjectSharpness;
  return detail * 0.7 + (unit(e.poseScore) ? e.poseScore * 0.15 : 0) + (1 - e.motionBlur) * 0.15;
}
export function selectBurstDetails(items: readonly SelectEvidence[]): SelectResult[] {
  const counts = new Map<string, number>();
  for (const e of items) counts.set(e.photoId, (counts.get(e.photoId) ?? 0) + 1);
  const rows = items.map(e => {
    const valid = counts.get(e.photoId) === 1 && evidenceValid(e);
    const conflict = valid && contradiction(e);
    const value = valid && !conflict ? score(e) : null;
    const group = valid && e.burstId ? JSON.stringify([e.genre, e.burstId]) : null;
    const crop = valid ? (box(e.eyeBox) ? cropAround(e.eyeBox) : box(e.subjectBox) ? cropAround(e.subjectBox) : null) : null;
    return { e, valid, conflict, value, group, crop };
  });
  const manuallyKept = new Set(rows.filter(r => r.valid && r.group && r.e.manualDecision === 'keep').map(r => r.group));
  const best = new Map<string, { id: string; score: number }>();
  for (const r of rows) {
    if (!r.group || r.value === null || r.e.manualDecision || manuallyKept.has(r.group)) continue;
    const old = best.get(r.group);
    if (!old || r.value > old.score || (r.value === old.score && r.e.photoId < old.id))
      best.set(r.group, { id: r.e.photoId, score: r.value });
  }
  return rows.map(r => {
    // A duplicate identity is never allowed to inherit a manual Keep or Reject.
    if (!r.valid) return { photoId: r.e.photoId, crop: null, recommendation: 'review', reason: 'uncertain', score: null, comparisonGroup: null };
    if (r.e.manualDecision === 'keep' || r.e.manualDecision === 'reject' || r.e.manualDecision === 'review')
      return { photoId: r.e.photoId, crop: r.crop, recommendation: r.e.manualDecision, reason: 'manual', score: r.value, comparisonGroup: r.group };
    if (r.conflict) return { photoId: r.e.photoId, crop: r.crop, recommendation: 'review', reason: 'conflict', score: null, comparisonGroup: r.group };
    if (r.value === null || !r.group || r.e.genre === 'unknown')
      return { photoId: r.e.photoId, crop: r.crop, recommendation: 'review', reason: 'uncertain', score: r.value, comparisonGroup: r.group };
    const winner = best.get(r.group)?.id === r.e.photoId;
    return { photoId: r.e.photoId, crop: r.crop, recommendation: winner ? 'keep' : 'review', reason: winner ? 'best-in-burst' : 'other-candidate', score: r.value, comparisonGroup: r.group };
  });
}

/** Closed-set bird detection gates open-set species naming.
 * A species model must never turn a helicopter into a bird just because
 * "helicopter" is absent from the species label vocabulary.
 */
export interface DetectedMacroSubject {
  detection: { label: string; score: number };
  coverage: number;
}

/** Only confident, positively detected birds open automatic bird species naming. */
export function permitsUnclassifiedBirdSpecies(found: DetectedMacroSubject | null): boolean {
  if (!found || found.detection.label !== 'bird') return false;
  const score = found.detection.score, area = found.coverage;
  if (!Number.isFinite(score) || !Number.isFinite(area) ||
      score < 0 || score > 1 || area <= 0 || area > 1) return false;
  return (score >= 0.72 && area >= 0.008) || (score >= 0.90 && area >= 0.003);
}

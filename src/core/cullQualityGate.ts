import type { CullBenchmarkResult } from './cullBenchmark';

export interface CullQualityTargets {
  /** Minimum number of independently labelled favourites. */
  minFavourites: number;
  /** Minimum total independent labels. */
  minPhotos: number;
  /** Maximum fraction of the shoot retained for human review. */
  maxReviewFraction: number;
  /** Minimum fraction of photographer favourites retained. */
  minRecall: number;
  /** Minimum fraction of automatic Keep selections confirmed as favourites. */
  minAutoKeepPrecision: number;
  /** Minimum proportion of photos with valid, unique predictions. */
  minPredictionCoverage: number;
}

export const DEFAULT_CULL_QUALITY_TARGETS: Readonly<CullQualityTargets> = Object.freeze({
  minFavourites: 10,
  minPhotos: 50,
  maxReviewFraction: 0.4,
  minRecall: 0.95,
  minAutoKeepPrecision: 0.8,
  minPredictionCoverage: 0.95,
});

export type CullQualityStatus = 'pass' | 'fail' | 'insufficient-evidence';
export interface CullQualityGate {
  status: CullQualityStatus;
  /** Human-readable reasons; no individual photo identifiers are exported. */
  reasons: string[];
  reviewFraction: number | null;
  predictionCoverage: number | null;
}

/**
 * This is a benchmark quality gate, not a production photo-deletion policy.
 * Unknown predictions stay reviewable; no labels, image bytes, or originals
 * are modified or uploaded. Insufficient data never passes by default.
 */
export function evaluateCullQualityGate(
  result: CullBenchmarkResult,
  targets: Readonly<CullQualityTargets> = DEFAULT_CULL_QUALITY_TARGETS,
): CullQualityGate {
  const values = [
    targets.minFavourites, targets.minPhotos, targets.maxReviewFraction,
    targets.minRecall, targets.minAutoKeepPrecision, targets.minPredictionCoverage,
  ];
  if (!values.every(Number.isFinite) || targets.minFavourites < 1 || targets.minPhotos < 1 ||
    !Number.isInteger(targets.minFavourites) || !Number.isInteger(targets.minPhotos) ||
    values.slice(2).some((value) => value < 0 || value > 1)) {
    throw new Error('Invalid culling quality targets');
  }
  if (!Number.isSafeInteger(result.total) || result.total < 0 ||
    !Number.isSafeInteger(result.favourites) || result.favourites < 0 ||
    result.favourites > result.total ||
    !Number.isSafeInteger(result.suggested) || result.suggested < 0 || result.suggested > result.total ||
    !Number.isSafeInteger(result.missingPredictions) || result.missingPredictions < 0 ||
    result.missingPredictions > result.total) {
    throw new Error('Invalid benchmark result counts');
  }
  const reviewFraction = result.total ? result.suggested / result.total : null;
  const predictionCoverage = result.total ? (result.total - result.missingPredictions) / result.total : null;
  const evidence: string[] = [];
  if (result.total < targets.minPhotos) evidence.push('Not enough independently labelled photographs');
  if (result.favourites < targets.minFavourites) evidence.push('Not enough independently labelled favourites');
  if (result.recall === null || !Number.isFinite(result.recall)) evidence.push('Favourite recall unavailable');
  if (result.autoKeepPrecision === null || !Number.isFinite(result.autoKeepPrecision)) {
    evidence.push('Automatic Keep precision unavailable');
  }
  if (evidence.length) return { status: 'insufficient-evidence', reasons: evidence, reviewFraction, predictionCoverage };
  const failures: string[] = [];
  if (result.recall! < targets.minRecall) failures.push('Favourite recall below target');
  if (result.autoKeepPrecision! < targets.minAutoKeepPrecision) failures.push('Automatic Keep precision below target');
  if (reviewFraction! > targets.maxReviewFraction) failures.push('Review workload above target');
  if (predictionCoverage! < targets.minPredictionCoverage) failures.push('Valid prediction coverage below target');
  if (result.unsafeRejections > 0) failures.push('Photographer favourites were automatically rejected');
  if (result.duplicatePredictions > 0) failures.push('Duplicate prediction identities');
  if (result.invalidPredictions > 0) failures.push('Invalid predictions');
  if (result.unexpectedPredictions > 0) failures.push('Unexpected prediction identities');
  return {
    status: failures.length ? 'fail' : 'pass',
    reasons: failures,
    reviewFraction, predictionCoverage,
  };
}

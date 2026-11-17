/**
 * Distribution-free Wilson score interval for a binomial proportion.
 * Pure/offline and camera-agnostic. This quantifies sampling uncertainty,
 * NOT whether labels or subject detections are trustworthy.
 */
export interface ProportionInterval {
  successes: number;
  trials: number;
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  confidenceLevel: 0.95;
}
const Z95 = 1.959963984540054;

export function wilson95(successes: number, trials: number): ProportionInterval {
  if (!Number.isSafeInteger(trials) || !Number.isSafeInteger(successes) ||
      trials < 0 || successes < 0 || successes > trials) {
    throw new Error('Invalid binomial sample counts');
  }
  if (trials === 0) return {
    successes, trials, estimate: null, lower: null, upper: null, confidenceLevel: 0.95,
  };
  const p = successes / trials;
  const z2 = Z95 * Z95;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const radius = Z95 * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials)) / denominator;
  return {
    successes, trials, estimate: p,
    lower: Math.max(0, centre - radius),
    upper: Math.min(1, centre + radius),
    confidenceLevel: 0.95,
  };
}

export type PhotoSubjectCategory = 'birds' | 'aircraft' | 'people' | 'mammals' | 'landscapes';
export interface CategorySample {
  category: PhotoSubjectCategory;
  favourites: number;
  retainedFavourites: number;
  autoKeeps: number;
  correctAutoKeeps: number;
}
export interface CategoryUncertainty {
  category: PhotoSubjectCategory;
  recall: ProportionInterval;
  autoKeepPrecision: ProportionInterval;
}

/**
 * Independent per-category uncertainty. A perfect 1/1 score has a very wide
 * interval; it is never presented as proven 100% real-world performance.
 */
export function categoryUncertainty(samples: readonly CategorySample[]): CategoryUncertainty[] {
  const seen = new Set<PhotoSubjectCategory>();
  return samples.map((sample) => {
    if (seen.has(sample.category)) throw new Error('Duplicate subject category');
    if (!['birds', 'aircraft', 'people', 'mammals', 'landscapes'].includes(sample.category)) {
      throw new Error('Invalid subject category');
    }
    seen.add(sample.category);
    return {
      category: sample.category,
      recall: wilson95(sample.retainedFavourites, sample.favourites),
      autoKeepPrecision: wilson95(sample.correctAutoKeeps, sample.autoKeeps),
    };
  });
}

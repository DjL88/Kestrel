/**
 * Auto-Cull measured on a shoot the photographer has already rated (finish-line job p5-cull, docs/QUALITY-BENCHMARKS.md).
 * Pure. The CLI (scripts/quality/cull-score.mts) reads the ratings from the originals or their sidecars and Kestrel's
 * own decisions from a project backup made after "Sort for me"; this joins the two and scores them with the app's own
 * benchmark (cullBenchmark.ts). The photographer's stars are the truth; Kestrel's decisions are only ever predictions.
 *
 * Honesty rules: a photo the camera or another app already marked as rejected is imported as rejected (it is the
 * person's mark, not Auto-Cull's), so it is never counted as an Auto-Cull prediction. A photo with no rating file is
 * not guessed: it is reported and left out. The numbers describe this one shoot only.
 */
import type { CullSuggestion } from './autoCull';
import { evaluateCullBenchmark, type CullBenchmarkCase, type CullBenchmarkResult } from './cullBenchmark';
import type { PhotoFrame } from './types';

export type CullCategory = CullBenchmarkCase['category'];
export const CULL_CATEGORIES: readonly CullCategory[] = ['birds', 'aircraft', 'people', 'mammals', 'landscapes'];

/** The photographer's own mark for one file, by file name. */
export interface PhotographerRating {
  /** 0 to 5 stars; 0 or absent is unrated. */
  stars?: number;
  /** Marked as a reject in the camera or another app (XMP Rating -1, or a reject flag). */
  rejected?: boolean;
  category?: CullCategory;
}

export interface CullRatingOptions {
  /** Stars at or above this make a photo a favourite that Auto-Cull must never reject. Default 3. */
  favouriteStars?: number;
  category?: CullCategory;
}

export interface CullRatingReport {
  result: CullBenchmarkResult;
  favouriteStars: number;
  /** Favourites Auto-Cull rejected, by file name. Every one should be looked at. */
  rejectedFavourites: string[];
  /** Rejections Auto-Cull made without high confidence: the rule is that none should exist. */
  unsureRejections: string[];
  /** Photos in the project with no rating found: left out, never guessed. */
  unrated: string[];
  /** Photos the person had already rejected before import: their mark, so not scored as a prediction. */
  rejectedBeforeImport: number;
  /** Photos Auto-Cull has not looked at (no score): counted as kept for review, never as rejects. */
  notScanned: number;
}

const key = (name: string) => name.trim().toLowerCase();

export function scoreCullAgainstRatings(
  frames: readonly PhotoFrame[], ratings: ReadonlyMap<string, PhotographerRating>, options: CullRatingOptions = {},
): CullRatingReport {
  const favouriteStars = options.favouriteStars ?? 3;
  if (!Number.isInteger(favouriteStars) || favouriteStars < 1 || favouriteStars > 5) throw new Error('Favourite stars must be 1 to 5');
  const byName = new Map<string, PhotographerRating>();
  for (const [name, rating] of ratings) {
    if (byName.has(key(name))) throw new Error(`Two ratings for ${name}`);
    if (rating.stars !== undefined && !(Number.isInteger(rating.stars) && rating.stars >= 0 && rating.stars <= 5)) throw new Error(`${name}: stars must be 0 to 5`);
    if (rating.category !== undefined && !CULL_CATEGORIES.includes(rating.category)) throw new Error(`${name}: unknown category`);
    byName.set(key(name), rating);
  }
  const active = frames.filter((frame) => frame.removedAt == null && !frame.virtualCopy && !frame.isDemo);
  const seen = new Set<string>();
  for (const frame of active) {
    if (seen.has(key(frame.filename))) throw new Error(`Two photos are called ${frame.filename}: rename one or score them separately`);
    seen.add(key(frame.filename));
  }
  const cases: CullBenchmarkCase[] = [];
  const suggestions: CullSuggestion[] = [];
  const rejectedFavourites: string[] = [], unsureRejections: string[] = [], unrated: string[] = [];
  let rejectedBeforeImport = 0, notScanned = 0;
  for (const frame of active) {
    const rating = byName.get(key(frame.filename));
    if (!rating) { unrated.push(frame.filename); continue; }
    const favourite = (rating.stars ?? 0) >= favouriteStars && !rating.rejected;
    cases.push({ id: frame.id, category: rating.category ?? options.category ?? 'birds', favourite, ...(rating.rejected ? { unusable: true } : {}) });
    if (frame.exif?.rejectedByMetadata) { rejectedBeforeImport += 1; continue; }
    if (frame.cullScore === undefined) notScanned += 1;
    const decision = frame.decision === 'keep' ? 'keep' : frame.decision === 'reject' ? 'reject' : null;
    const confidence = frame.cullConfidence ?? 'low';
    suggestions.push({ frameId: frame.id, decision, confidence, score: frame.cullScore ?? 0, reason: 'unavailable' });
    if (decision === 'reject' && favourite) rejectedFavourites.push(frame.filename);
    if (decision === 'reject' && confidence !== 'high') unsureRejections.push(frame.filename);
  }
  if (!cases.length) throw new Error('No rated photos matched this project: check the folder and the file names');
  return { result: evaluateCullBenchmark(cases, suggestions), favouriteStars, rejectedFavourites, unsureRejections, unrated, rejectedBeforeImport, notScanned };
}

const pct = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value * 1000) / 10}%`);

export function describeCullRatingReport(report: CullRatingReport): string {
  const r = report.result;
  return [
    `${r.total} rated photos, ${r.favourites} favourites (${report.favouriteStars} stars or more).`,
    `Favourites kept or left for review: ${r.foundFavourites} of ${r.favourites} (${pct(r.recall)}). Target: 95% or more, and every rejected favourite looked at.`,
    `Favourites Auto-Cull rejected: ${report.rejectedFavourites.length}${report.rejectedFavourites.length ? ` (${report.rejectedFavourites.join(', ')})` : ''}.`,
    `Rejections without high confidence: ${report.unsureRejections.length} (must be 0)${report.unsureRejections.length ? ` (${report.unsureRejections.join(', ')})` : ''}.`,
    `Auto-Cull's own Keeps that are favourites: ${r.correctAutoKeeps} of ${r.autoKeeps} (${pct(r.autoKeepPrecision)}).`,
    `Left for you to review or kept: ${r.suggested} of ${r.total}, against ${r.total} with no Auto-Cull.`,
    `Not scored: ${report.unrated.length} with no rating found, ${report.rejectedBeforeImport} already rejected before import, ${report.notScanned} not scanned by Auto-Cull.`,
  ].join('\n');
}

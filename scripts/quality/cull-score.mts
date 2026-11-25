// Auto-Cull measured on a shoot you have already rated. See docs/QUALITY-BENCHMARKS.md.
//   npx tsx scripts/quality/cull-score.mts <project backup .kestrel.json> <shoot folder> [--stars 3] [--category birds] [--ratings ratings.csv] [--json]
// Ratings come from each original's own XMP or TIFF rating, or from a sidecar (DSC_0001.xmp, as Lightroom writes), or
// from a CSV of filename,stars[,category] (stars -1 = rejected). Read-only: originals and sidecars are only read.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import exifr from 'exifr';
import { readEmbeddedRating } from '../../src/core/exifParser.ts';
import { restoreProjectBackup } from '../../src/core/projectBackup.ts';
import { CULL_CATEGORIES, describeCullRatingReport, scoreCullAgainstRatings, type CullCategory, type PhotographerRating } from '../../src/core/cullRatingScore.ts';

const args = process.argv.slice(2);
const option = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const [backupPath, folder] = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
if (!backupPath || !folder) {
  process.stderr.write('Usage: cull-score.mts <project backup .kestrel.json> <shoot folder> [--stars 3] [--category birds] [--ratings ratings.csv] [--json]\n');
  process.exit(2);
}
const category = option('--category') as CullCategory | undefined;
if (category && !CULL_CATEGORIES.includes(category)) throw new Error(`--category must be one of ${CULL_CATEGORIES.join(', ')}`);
const favouriteStars = option('--stars') ? Number(option('--stars')) : 3;

/** XMP Rating from a sidecar: xmp:Rating="4" or <xmp:Rating>4</xmp:Rating>. */
const sidecarRating = (text: string) => /xmp:Rating\s*(?:=\s*["']|>)\s*(-?\d)/.exec(text)?.[1];
const toRating = (found: { rating?: number; rejectedByMetadata?: boolean }): PhotographerRating | undefined =>
  found.rejectedByMetadata ? { rejected: true } : found.rating !== undefined ? { stars: found.rating } : undefined;

const ratings = new Map<string, PhotographerRating>();
const csv = option('--ratings');
if (csv) {
  for (const line of readFileSync(csv, 'utf8').split(/\r?\n/).slice(1)) {
    const [name, stars, rowCategory] = line.split(',').map((cell) => cell.trim());
    if (!name) continue;
    const value = Number(stars);
    ratings.set(name, { ...(value === -1 ? { rejected: true } : { stars: value }), ...(rowCategory ? { category: rowCategory as CullCategory } : {}) });
  }
} else {
  const pictures = /\.(nef|nrw|cr2|cr3|arw|raf|orf|rw2|dng|jpe?g|heic|hif|tiff?)$/i;
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (!pictures.test(name) || !statSync(path).isFile()) continue;
    const stem = basename(name, extname(name));
    const sidecar = [join(folder, `${stem}.xmp`), join(folder, `${stem}.XMP`), join(folder, `${name}.xmp`)].find(existsSync);
    let rating = sidecar ? toRating(readEmbeddedRating(sidecarRating(readFileSync(sidecar, 'utf8')), undefined)) : undefined;
    if (!rating) {
      const segments = await exifr.parse(path, { xmp: true, mergeOutput: false, tiff: true, exif: true }).catch(() => null);
      rating = toRating(readEmbeddedRating(segments?.xmp?.Rating, segments?.ifd0?.Rating));
    }
    // A picture with no rating anywhere is unrated (0 stars): in a rated shoot, that is a photo you did not pick.
    ratings.set(name, rating ?? { stars: 0 });
  }
}

const state = restoreProjectBackup(readFileSync(backupPath, 'utf8'), 'benchmark');
const report = scoreCullAgainstRatings(state.frames, ratings, { favouriteStars, category });
if (args.includes('--json')) process.stdout.write(JSON.stringify(report, null, 1) + '\n');
else process.stdout.write(describeCullRatingReport(report) + '\n');

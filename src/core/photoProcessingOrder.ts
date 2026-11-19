import type { PhotoFrame } from './types';

/**
 * Sample the length of a shoot instead of showing an entire burst first.
 * With 100 originals and five lanes: 1, 21, 41, 61, 81, 2, 22, ...
 * Changes processing order only: do not use its index as a photo identity or capture order.
 */
export function spreadPhotoOrder<T>(items: readonly T[], lanes = 5): T[] {
  if (!items.length) return [];
  const count = Number.isSafeInteger(lanes) && lanes > 0 ? Math.min(lanes, items.length) : Math.min(5, items.length);
  const stride = Math.ceil(items.length / count);
  const spread: T[] = [];
  for (let offset = 0; offset < stride; offset += 1) {
    for (let lane = 0; lane < count; lane += 1) {
      const index = lane * stride + offset;
      if (index < items.length) spread.push(items[index]);
    }
  }
  return spread;
}

function priority(frame: PhotoFrame): number {
  // Camera rejects are never treated as favourites, even if legacy metadata
  // contains a conflicting rating. They remain available for manual review.
  if (frame.decision === 'reject' || frame.exif.rejectedByMetadata) return -1;
  // The photographer's explicit rating (including clearing to zero) overrides EXIF.
  const stars = frame.rating ?? frame.exif.rating;
  if (typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= 5) return 10 + stars;
  return frame.decision === 'keep' ? 1 : 0;
}

/**
 * Background cull / Auto evaluation: see the highest camera or manual stars
 * first, followed by confirmed keepers; sample all unrated photos across the
 * shoot; leave camera-rejected photographs until the end. Scores and keeper
 * tiers are calculated by the existing global culling engine afterwards.
 * This MUST NOT reorder the stored catalogue or rewrite source timestamps.
 */
export function prioritizePhotoProcessing(frames: readonly PhotoFrame[]): PhotoFrame[] {
  const original = [...frames].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const preferred: PhotoFrame[] = [];
  const ordinary: PhotoFrame[] = [];
  const rejected: PhotoFrame[] = [];
  for (const frame of original) {
    const rank = priority(frame);
    if (rank < 0) rejected.push(frame);
    else if (rank > 0) preferred.push(frame);
    else ordinary.push(frame);
  }
  preferred.sort((a, b) => priority(b) - priority(a));
  return [...preferred, ...spreadPhotoOrder(ordinary), ...spreadPhotoOrder(rejected)];
}

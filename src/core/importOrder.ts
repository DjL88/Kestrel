/**
 * The order a large import reads its photos in: rated photos first, so the best arrive on screen first, and in groups so
 * the project is updated once per group instead of once per photo.
 *
 * Only the reading order changes. Each photo keeps its own position in the picked list (its id and capture-order
 * sequence number come from that position), the catalogue sorts an import's photos by it as they arrive, and a rating is
 * only read, never written or changed.
 */

/** The star rating (1 to 5) an XMP sidecar records, or undefined for none, zero, a reject flag or anything unreadable. */
export function parseXmpRating(xmp: string): number | undefined {
  const match = /xmp:Rating\s*=\s*["']\s*(-?\d+)\s*["']/i.exec(xmp) ?? /<xmp:Rating>\s*(-?\d+)\s*<\/xmp:Rating>/i.exec(xmp);
  if (!match) return undefined;
  const stars = Number(match[1]);
  return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : undefined;
}

/**
 * Positions 0..n-1 ordered highest stars first; photos with the same rating, and all unrated photos, keep the order they
 * were picked in.
 */
export function ratedFirstOrder(ratings: ReadonlyArray<number | undefined>): number[] {
  const order = ratings.map((_, index) => index);
  const stars = (index: number) => ratings[index] ?? 0;
  return order.sort((a, b) => stars(b) - stars(a) || a - b);
}

/** Consecutive groups of at most `size` entries (size is kept between 1 and 64). */
export function inGroups<T>(items: readonly T[], size: number): T[][] {
  const width = Number.isFinite(size) ? Math.min(64, Math.max(1, Math.floor(size))) : 1;
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += width) groups.push(items.slice(start, start + width));
  return groups;
}

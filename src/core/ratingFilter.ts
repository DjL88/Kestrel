import type { PhotoFrame, RatingFilter } from './types';

/** The star rating Kestrel shows for a photo: the user's rating, else the one embedded in the file, else none. */
export function ratingOf(frame: Pick<PhotoFrame, 'rating' | 'exif'>): number {
  return frame.rating ?? frame.exif?.rating ?? 0;
}

export function matchesRating(frame: Pick<PhotoFrame, 'rating' | 'exif'>, filter: RatingFilter | null | undefined): boolean {
  if (!filter) return true;
  const rating = ratingOf(frame);
  return filter.mode === 'atLeast' ? rating >= filter.value : rating === filter.value;
}

/** Choices for the filter control, as "any", "min:3" or "eq:0" so one select can hold both modes. */
export function encodeRatingFilter(filter: RatingFilter | null | undefined): string {
  if (!filter) return 'any';
  return `${filter.mode === 'atLeast' ? 'min' : 'eq'}:${filter.value}`;
}

export function decodeRatingFilter(value: string): RatingFilter | null {
  const match = /^(min|eq):([0-5])$/.exec(value);
  if (!match) return null;
  return { mode: match[1] === 'min' ? 'atLeast' : 'exactly', value: Number(match[2]) };
}

export function describeRatingFilter(filter: RatingFilter | null | undefined): string {
  if (!filter) return 'Any rating';
  if (filter.mode === 'exactly') return filter.value === 0 ? 'Unrated' : `Exactly ${filter.value}★`;
  return `${filter.value}★ or more`;
}

/** Choosing the star you already have switched on clears the filter, so one tap undoes it. */
export function pickRating(current: RatingFilter | null | undefined, mode: RatingFilter['mode'], value: number): RatingFilter | null {
  return current && current.mode === mode && current.value === value ? null : { mode, value };
}

/** Switch between "this many or more" and "exactly this many", keeping the chosen stars. */
export function flipRatingMode(current: RatingFilter | null | undefined): RatingFilter['mode'] {
  return current?.mode === 'exactly' ? 'atLeast' : 'exactly';
}

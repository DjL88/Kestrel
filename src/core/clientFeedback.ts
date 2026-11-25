/**
 * Client feedback as reviewable items in the project (#1387 C07). `galleryFeedback.ts` summarises what clients did per
 * photo; this adds the photographer's review of it: each photo with feedback is new until marked done or dismissed, and
 * comes back as new when a client acts on it again after that review, so nothing a client says is silently swallowed.
 *
 * Owner rule: client feedback is never auto-applied. A client's pick (a favourite or an approval) can become a flag on
 * the photo only when the photographer chooses "Flag it" (`flagFor`); comments and change requests are only read.
 */
import type { GalleryFeedbackEvent, PhotoFeedback } from './galleryFeedback';

export type ReviewState = 'new' | 'done' | 'dismissed';
export interface FeedbackReview { itemId: string; state: Exclude<ReviewState, 'new'>; byName: string; atMs: number }

export const FEEDBACK_ITEM_ID = /^photo:[A-Za-z0-9_-]{1,96}$/;
export const feedbackItemId = (photoId: string) => `photo:${photoId}`;

/** When clients last acted on each photo. "Approve all" counts for every photo in the gallery. */
export function lastActivity(events: readonly GalleryFeedbackEvent[], photoIds: readonly string[]): Map<string, number> {
  const inGallery = new Set(photoIds);
  const last = new Map<string, number>();
  const touch = (id: string, at: number) => { if (inGallery.has(id) && at > (last.get(id) ?? -Infinity)) last.set(id, at); };
  for (const e of events) {
    if (e.kind === 'approve-all') photoIds.forEach((id) => touch(id, e.atMs));
    else if (e.photoId) touch(e.photoId, e.atMs);
  }
  return last;
}

/** New, unless reviewed after the last thing a client did on this photo. */
export function reviewState(photoId: string, last: ReadonlyMap<string, number>, reviews: readonly FeedbackReview[]): { state: ReviewState; byName: string | null } {
  const review = reviews.find((r) => r.itemId === feedbackItemId(photoId));
  const at = last.get(photoId);
  if (!review || at === undefined || review.atMs < at) return { state: 'new', byName: null };
  return { state: review.state, byName: review.byName };
}

/**
 * The only decision client feedback can lead to, and only when the photographer chooses it: flag a photo clients
 * picked (favourited or approved), if it is in this project and not flagged already. Anything else gives null.
 */
export function flagFor(photo: PhotoFeedback, decisionInProject: (photoId: string) => 'unreviewed' | 'keep' | 'reject' | null): { photoId: string; decision: 'keep' } | null {
  if (photo.favourites + photo.approvals === 0) return null;
  const current = decisionInProject(photo.photoId);
  if (current === null || current === 'keep') return null;
  return { photoId: photo.photoId, decision: 'keep' };
}

/** Photos with any client feedback, new ones first, keeping the gallery's order within each group. */
export function reviewOrder<T extends { state: ReviewState }>(rows: readonly T[]): T[] {
  return [...rows.filter((r) => r.state === 'new'), ...rows.filter((r) => r.state !== 'new')];
}

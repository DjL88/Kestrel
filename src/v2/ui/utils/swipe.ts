/** A clean single-finger flick on the photo. Left or right steps through photos, up or down through the formats of one photo. */
export type SwipeIntent = 'next-photo' | 'previous-photo' | 'next-format' | 'previous-format';

export const SWIPE_MIN_DISTANCE = 56; // px: far enough that it was meant
export const SWIPE_AXIS_RATIO = 1.6; // how much longer the main axis must be than the other, so a diagonal drag is not a swipe
export const SWIPE_MAX_MS = 700; // slower than this is a drag or a hold, not a flick

export const TAP_MAX_DISTANCE = 10; // px: a finger that barely moved
export const TAP_MAX_MS = 300; // longer is a press or the start of a hold (the hold for the original starts at 450 ms)

/** A clean single-finger tap on the photo: down and up in almost the same place, quickly. */
export function isTap(dx: number, dy: number, ms: number): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(ms >= 0) || ms > TAP_MAX_MS) return false;
  return Math.hypot(dx, dy) <= TAP_MAX_DISTANCE;
}

export function swipeIntent(dx: number, dy: number, ms: number): SwipeIntent | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(ms >= 0) || ms > SWIPE_MAX_MS) return null;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < SWIPE_MIN_DISTANCE) return null;
  if (ax >= ay * SWIPE_AXIS_RATIO) return dx < 0 ? 'next-photo' : 'previous-photo';
  if (ay >= ax * SWIPE_AXIS_RATIO) return dy < 0 ? 'next-format' : 'previous-format';
  return null;
}

/** The item `delta` steps from the current one, or undefined at either end (a swipe never wraps round). */
export function stepFrom<T extends { id: string }>(list: readonly T[], currentId: string | undefined, delta: 1 | -1): T | undefined {
  const index = list.findIndex((item) => item.id === currentId);
  if (index < 0) return undefined;
  return list[index + delta];
}

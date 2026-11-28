/**
 * One-finger touch classification for the canvas: is a finger that has just lifted a tap, and do two taps make a
 * double-tap? Pure and clock-free (callers pass the event time), so it is unit tested without a browser.
 *
 * A double-tap is decided here, from pointer events, rather than left to the browser's `dblclick`: iOS Safari and
 * the Android WebView only fire `dblclick` for a double-tap in some `touch-action` states, and a double-tap must never
 * double as the browser's own double-tap-to-zoom. The canvas keeps `touch-action: none`, so nothing else claims it.
 */
export const TAP_MAX_MS = 350;
/** Less than the canvas's 450 ms hold-to-see-the-original, so a tap and a hold never overlap. */
export const TAP_MAX_TRAVEL_PX = 10;
export const DOUBLE_TAP_GAP_MS = 350;
export const DOUBLE_TAP_MAX_DISTANCE_PX = 40;

export interface TouchSample { x: number; y: number; t: number }

/** A finger down then up is a tap when it was quick and barely moved. A longer or wider touch is a hold or a drag. */
export function isTap(down: TouchSample, up: TouchSample): boolean {
  const elapsed = up.t - down.t;
  if (!(elapsed >= 0) || elapsed > TAP_MAX_MS) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_MAX_TRAVEL_PX;
}

export interface DoubleTapDetector {
  /** A finger lifted. True when this tap completes a double-tap. A third tap starts a new pair. */
  lift(down: TouchSample, up: TouchSample): boolean;
  /** Forget a tap in progress: a pinch, a hold or a cancelled touch broke the pair. */
  reset(): void;
}

export function createDoubleTapDetector(): DoubleTapDetector {
  let previous: TouchSample | null = null;
  return {
    lift(down, up) {
      if (!isTap(down, up)) { previous = null; return false; }
      const first = previous;
      if (first && up.t - first.t <= DOUBLE_TAP_GAP_MS && up.t >= first.t
        && Math.hypot(up.x - first.x, up.y - first.y) <= DOUBLE_TAP_MAX_DISTANCE_PX) {
        previous = null;
        return true;
      }
      previous = { x: up.x, y: up.y, t: up.t };
      return false;
    },
    reset() { previous = null; },
  };
}

/**
 * Touch and pen long-press, for opening a context menu where the platform does
 * not (iOS Safari never fires `contextmenu`). A mouse keeps its right-click, so
 * it is ignored here. Pure and timer-injectable so it can be unit tested.
 */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_TOLERANCE_PX = 10;

export interface LongPressPoint { x: number; y: number; pointerType: string }
export interface LongPressTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}
const REAL_TIMERS: LongPressTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface LongPress {
  down(point: LongPressPoint): void;
  move(point: Pick<LongPressPoint, 'x' | 'y'>): void;
  /** Ends the press. True when it was a long press, so the click that follows should be ignored. */
  up(): boolean;
  cancel(): void;
}

export function createLongPress(
  onLongPress: (point: { x: number; y: number }) => void,
  options: { delayMs?: number; tolerancePx?: number; timers?: LongPressTimers } = {},
): LongPress {
  const { delayMs = LONG_PRESS_MS, tolerancePx = LONG_PRESS_TOLERANCE_PX, timers = REAL_TIMERS } = options;
  let handle: unknown = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  const stop = () => { if (handle !== null) timers.clear(handle); handle = null; start = null; };
  return {
    down(point) {
      stop();
      fired = false;
      if (point.pointerType !== 'touch' && point.pointerType !== 'pen') return;
      start = { x: point.x, y: point.y };
      handle = timers.set(() => {
        const at = start;
        handle = null;
        if (!at) return;
        fired = true;
        onLongPress(at);
      }, delayMs);
    },
    move(point) {
      if (!start) return;
      if (Math.hypot(point.x - start.x, point.y - start.y) > tolerancePx) stop();
    },
    up() {
      stop();
      const was = fired;
      fired = false;
      return was;
    },
    cancel() { stop(); fired = false; },
  };
}

/**
 * Canvas tips (Dave, 27 Nov: "hide the text on the canvas, only show it occasionally as a prompt about how to use the
 * canvas"). A short tip shows the first few times the editor opens and the first few times Crop starts, in the status
 * line under the canvas, never over the photo. View › Show canvas tips brings them back. Kept on this device only.
 */
export type CanvasTipKind = 'view' | 'crop';

/** How many times each tip shows before it stays away. */
export const TIP_TIMES = 3;
/** How long a tip stays, unless the pointer or keyboard is on it. */
export const TIP_MS = 8000;
/** The window event View › Show canvas tips sends. */
export const CANVAS_TIPS_EVENT = 'inflight:canvas-tips';

const KEY = 'inflight.v2.canvasTips';

export interface TipsState { on: boolean; seen: Partial<Record<CanvasTipKind, number>> }

const FRESH: TipsState = { on: true, seen: {} };

export function readTips(store: Pick<Storage, 'getItem'> | null | undefined): TipsState {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return FRESH;
    const value = JSON.parse(raw) as Partial<TipsState>;
    const seen: TipsState['seen'] = {};
    for (const kind of ['view', 'crop'] as const) {
      const n = value.seen?.[kind];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) seen[kind] = Math.floor(n);
    }
    return { on: value.on !== false, seen };
  } catch {
    return FRESH;
  }
}

export function writeTips(store: Pick<Storage, 'setItem'> | null | undefined, state: TipsState): void {
  try { store?.setItem(KEY, JSON.stringify(state)); } catch { /* not kept: tips simply show again next time */ }
}

/** Whether this tip should show now. */
export const tipDue = (state: TipsState, kind: CanvasTipKind): boolean => state.on && (state.seen[kind] ?? 0) < TIP_TIMES;

/** The state after a tip has been shown once. */
export const tipShown = (state: TipsState, kind: CanvasTipKind): TipsState =>
  ({ ...state, seen: { ...state.seen, [kind]: (state.seen[kind] ?? 0) + 1 } });

/** View › Show canvas tips: on again, as if new. */
export const tipsAgain = (): TipsState => ({ on: true, seen: {} });

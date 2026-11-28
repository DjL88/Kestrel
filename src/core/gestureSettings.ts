/**
 * What a double-tap on the photo does. The default follows the convention in Apple Photos, Google Photos, Lightroom mobile
 * and Photoshop on iPad: it zooms in on the spot tapped, and again to go back to Fit. Crop is still one tap away on its
 * visible button; people who want the double-tap to open it instead can choose that. Each device remembers its own choice.
 * (A fuller per-gesture registry in Settings builds on this.)
 */
export type DoubleTapAction = 'zoom' | 'crop' | 'off';

export const DOUBLE_TAP_ACTION_KEY = 'inflight.v2.gesture.double-tap';
export const DEFAULT_DOUBLE_TAP_ACTION: DoubleTapAction = 'zoom';
export const DOUBLE_TAP_ACTIONS: readonly DoubleTapAction[] = ['zoom', 'crop', 'off'];

export function readDoubleTapAction(storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): DoubleTapAction {
  try {
    const value = storage?.getItem(DOUBLE_TAP_ACTION_KEY);
    return DOUBLE_TAP_ACTIONS.includes(value as DoubleTapAction) ? (value as DoubleTapAction) : DEFAULT_DOUBLE_TAP_ACTION;
  } catch { return DEFAULT_DOUBLE_TAP_ACTION; }
}

/** Remembered on this device only; if storage is blocked the choice lasts for this session. */
export function writeDoubleTapAction(action: DoubleTapAction, storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    if (action === DEFAULT_DOUBLE_TAP_ACTION) storage?.removeItem(DOUBLE_TAP_ACTION_KEY);
    else storage?.setItem(DOUBLE_TAP_ACTION_KEY, action);
  } catch { /* lasts for this session */ }
}

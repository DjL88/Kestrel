/**
 * Dials and pad keys that turn a slider (TourBox, Loupedeck, macro pad dials, or keys set in Settings > Keyboard).
 * A nudge moves "the slider in use": the last slider the person touched, dragged or tabbed to, or Exposure when none
 * has been used yet. It changes the slider exactly as dragging it would, through the slider's own change handler, so it
 * is the same reversible edit with the same undo, and it never reaches a slider that is hidden, disabled or gone.
 */

/** The slider's next value: `steps` of its own step, kept inside its range, without floating-point drift. */
export function nudgedValue(value: number, min: number, max: number, step: number, steps: number): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) && max >= lo ? max : lo + 100;
  const start = Number.isFinite(value) ? value : lo;
  const decimals = (String(safeStep).split('.')[1] ?? '').length;
  const next = Math.min(hi, Math.max(lo, start + safeStep * (Number.isFinite(steps) ? Math.trunc(steps) : 0)));
  return Number(next.toFixed(decimals));
}

/** One click of a dial moves one step; the "more" commands move ten, as a held Shift does on most dials. */
export const NUDGE_STEPS = { up: 1, down: -1, upMore: 10, downMore: -10 } as const;
export type NudgeDirection = keyof typeof NUDGE_STEPS;

const FALLBACK_SLIDER_ID = 'slider-exposure';
let lastSlider: WeakRef<HTMLInputElement> | null = null;

function isRange(target: EventTarget | null): target is HTMLInputElement {
  return typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement && target.type === 'range';
}

/** Remembers the slider the person last used. Call once; returns the function that stops listening. */
export function trackSliderInUse(doc: Document = document): () => void {
  const remember = (event: Event) => { if (isRange(event.target)) lastSlider = new WeakRef(event.target); };
  doc.addEventListener('focusin', remember, true);
  doc.addEventListener('pointerdown', remember, true);
  doc.addEventListener('input', remember, true);
  return () => {
    doc.removeEventListener('focusin', remember, true);
    doc.removeEventListener('pointerdown', remember, true);
    doc.removeEventListener('input', remember, true);
  };
}

function usable(el: HTMLInputElement | null | undefined): el is HTMLInputElement {
  return Boolean(el && el.isConnected && !el.disabled && el.getClientRects().length > 0);
}

/** Moves the slider in use. Returns false when there is no slider to move (the Adjust panel is closed, say). */
export function nudgeSliderInUse(direction: NudgeDirection, doc: Document = document): boolean {
  const remembered = lastSlider?.deref();
  const fallback = doc.getElementById(FALLBACK_SLIDER_ID);
  const el = usable(remembered) ? remembered : isRange(fallback) && usable(fallback) ? fallback : null;
  if (!el) return false;
  const next = nudgedValue(Number(el.value), Number(el.min || 0), Number(el.max || 100), Number(el.step || 1), NUDGE_STEPS[direction]);
  if (String(next) === el.value) return true;
  // Set the value the way a drag does, so React's own onChange runs (a plain `el.value =` would be ignored by React).
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, String(next));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  lastSlider = new WeakRef(el);
  return true;
}

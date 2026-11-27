/**
 * Whether the person is dragging an edit control right now (a slider thumb held down, or another control marked
 * `data-live-drag`). While a drag lasts, the editor draws a quick screen-size picture and skips work that only matters once
 * the hand is still (the full-quality redraw, its PNG, the 16-bit pass and the histogram). When the drag ends, listeners
 * are told, and the full-quality picture is drawn exactly as it is without a drag.
 *
 * One listener on the document covers every slider in every panel, so no control has to report its own drag.
 */
const DRAG_CONTROLS = 'input[type="range"], [data-live-drag]';

let dragging = false;
let installed = false;
const endListeners = new Set<() => void>();

function end(): void {
  if (!dragging) return;
  dragging = false;
  for (const listener of [...endListeners]) {
    try { listener(); } catch { /* one listener failing never stops the others */ }
  }
}

function install(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(DRAG_CONTROLS)) dragging = true;
  }, { capture: true });
  // The pointer may be let go outside the slider (or outside the window), so the end is heard everywhere.
  window.addEventListener('pointerup', end, { capture: true });
  window.addEventListener('pointercancel', end, { capture: true });
  window.addEventListener('blur', end);
  document.addEventListener('visibilitychange', () => { if (document.hidden) end(); });
}

/** True while an edit control is being dragged. */
export function editGestureActive(): boolean {
  install();
  return dragging;
}

/** Call `listener` each time a drag of an edit control ends. Returns a function that stops listening. */
export function onEditGestureEnd(listener: () => void): () => void {
  install();
  endListeners.add(listener);
  return () => { endListeners.delete(listener); };
}

/** Tests only: start or end a drag without a pointer. */
export function setEditGestureForTest(active: boolean): void {
  install();
  if (active) dragging = true; else end();
}

// Listen from the start, so the first drag after the app opens is heard too.
install();

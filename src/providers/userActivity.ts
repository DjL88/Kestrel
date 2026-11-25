/**
 * When the person last pressed a key, clicked, touched or scrolled, so background work on this device (photo
 * similarity, for one) can wait while they are culling and never make the next photo late. Nothing is recorded but
 * the time of the last input, and only in memory.
 */
let lastInputAt = 0;
let listening = false;

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const note = () => { lastInputAt = performance.now(); };
  for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) window.addEventListener(type, note, { capture: true, passive: true });
}

/** How long to wait before the background may run: the remaining part of `quietMs` since the last input, or 0. */
export function quietWaitMs(now: number, last: number, quietMs: number): number {
  return Math.max(0, last + quietMs - now);
}

/** Resolves once the person has not touched the keyboard, mouse or screen for `quietMs`. */
export async function untilQuiet(quietMs: number): Promise<void> {
  listen();
  for (;;) {
    const wait = quietWaitMs(performance.now(), lastInputAt, quietMs);
    if (wait <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** Start noting input now, so a key pressed before the first background job still counts. */
export function startNotingInput(): void { listen(); }

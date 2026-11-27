/**
 * Performance marks for the live preview (slider change to pixels on screen). Each step is recorded as a
 * `performance.measure` named `inflight:<step>`, so a browser trace, a Playwright test or Settings can show where the time
 * went on a real photo. Recording never throws and never changes what is drawn.
 */
export function measureStep(step: string, start: number, detail?: Record<string, unknown>): void {
  try {
    performance.measure(`inflight:${step}`, { start, end: performance.now(), detail });
  } catch {
    // An engine without measure options: nothing is recorded.
  }
}

/** Run a synchronous step and record how long it held the thread. */
export function timedStep<T>(step: string, run: () => T, detail?: Record<string, unknown>): T {
  const start = performance.now();
  try {
    return run();
  } finally {
    measureStep(step, start, detail);
  }
}

/** Await a step and record how long it took from start to finish (not all of it is on this thread). */
export async function timedWait<T>(step: string, run: () => Promise<T>, detail?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    measureStep(step, start, detail);
  }
}

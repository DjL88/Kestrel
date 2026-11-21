/**
 * Yield control so React's busy state can be painted before CPU-heavy
 * preview decoding or model setup starts. This is not a delay for the user:
 * work resumes immediately after the next opportunity to paint.
 * Hidden/background windows use a bounded fallback rather than hanging.
 */
export function yieldToPaint(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let fallback: number | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallback !== undefined) window.clearTimeout(fallback);
      resolve();
    };
    fallback = window.setTimeout(finish, 80);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => { window.setTimeout(finish, 0); });
    }
  });
}

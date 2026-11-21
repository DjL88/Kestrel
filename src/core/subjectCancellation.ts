/** Cancellation boundary for local subject inference. An aborted photo must never
 * deliver a mask to a different photo, even if the ONNX session cannot stop. */
export function assertSubjectActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Subject search cancelled', 'AbortError');
}

/** Wait for a detector for at most budgetMs, with cleanup of the timer and
 * abort listener. Timeout is a recoverable null (whole-photo fallback);
 * cancellation is NOT a fallback and must propagate to the editor. */
export function boundedSubjectGuide<T>(
  work: Promise<T>,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<T | null> {
  // A function that returns a promise rejects for an already-cancelled photo; it must not throw synchronously.
  if (signal?.aborted) return Promise.reject(new DOMException('Subject search cancelled', 'AbortError'));
  if (!Number.isFinite(budgetMs) || budgetMs < 1) throw new RangeError('Invalid subject guide budget');
  return new Promise<T | null>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new DOMException('Subject search cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(null), budgetMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    // Attach handlers even after timeout/abort so late rejection is consumed.
    work.then(finish, fail);
  });
}

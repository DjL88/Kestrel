/**
 * A local model may hold hundreds of megabytes of WASM state. Serialize
 * inference sessions, including startup and release, to avoid parallel OOMs.
 * Waiting callers can be cancelled without running their own work.
 */
export function createSerialInferenceQueue() {
  let previous: Promise<void> = Promise.resolve();
  return async function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const cancelled = () => new DOMException('Photo check cancelled', 'AbortError');
    if (signal?.aborted) throw cancelled();
    const before = previous;
    let release!: () => void;
    previous = new Promise<void>(resolve => { release = resolve; });
    let reachedFront = false;
    let onAbort: (() => void) | undefined;
    try {
      if (signal) {
        const stopped = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(cancelled());
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        await Promise.race([before, stopped]);
        signal.removeEventListener('abort', onAbort!);
      } else {
        await before;
      }
      reachedFront = true;
      if (signal?.aborted) throw cancelled();
      const result = await work();
      if (signal?.aborted) throw cancelled();
      return result;
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      // Reject a waiting caller immediately, but keep its queue barrier until
      // the previous model releases its resources. Never overlap sessions.
      if (reachedFront) release();
      else void before.then(release, release);
    }
  };
}

/**
 * A local model may hold hundreds of megabytes of WASM state. Serialize
 * inference sessions, including startup and release, to avoid parallel OOMs.
 * Waiting callers can be cancelled without running their own work.
 */
export function createSerialInferenceQueue() {
  let previous: Promise<void> = Promise.resolve();
  return async function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const before = previous;
    let release!: () => void;
    previous = new Promise<void>(resolve => { release = resolve; });
    try {
      await before;
      if (signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
      return await work();
    } finally {
      release();
    }
  };
}

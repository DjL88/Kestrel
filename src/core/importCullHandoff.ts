/**
 * Transfer an optional import-time observer to the background cull without
 * blocking the import completion path. The background worker awaits only this
 * small handoff before it resets the shared subject detector.
 *
 * Nothing from a cancelled/failed observer may be used to auto-keep/reject.
 */
export interface PendingImportObservation<T> {
  finish(): Promise<T | undefined>;
  abort(): void;
}

export async function settleImportObservation<T>(
  pending: PendingImportObservation<T> | undefined,
  signal: AbortSignal,
): Promise<T | undefined> {
  if (!pending) return undefined;
  if (signal.aborted) {
    pending.abort();
    return undefined;
  }
  const cancel = () => pending.abort();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const observation = await pending.finish().catch(() => undefined);
    return signal.aborted ? undefined : observation;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (signal.aborted) pending.abort();
  }
}

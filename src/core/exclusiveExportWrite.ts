/**
 * Stream an export into an exclusively-created destination.
 *
 * The platform adapter must open with createNew, never truncate an existing
 * file. A successful return means all bytes were accepted and the handle closed.
 * If an in-progress write fails, only the new file opened by this call is
 * cleaned up. This is not a durable fsync/rename transaction.
 */
export interface ExclusiveWriteHandle {
  write(bytes: Uint8Array): Promise<number>;
  close(): Promise<void>;
}

export async function writeExclusiveBlob(
  blob: Blob,
  openExclusive: () => Promise<ExclusiveWriteHandle>,
  removeIncomplete: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  // Open first. A collision or permissions failure must not remove a file that
  // existed before this call.
  signal?.throwIfAborted();
  const handle = await openExclusive();
  const reader = blob.stream().getReader();
  let closed = false;
  let complete = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('The export stream returned invalid bytes.');
      let offset = 0;
      while (offset < value.byteLength) {
        signal?.throwIfAborted();
        const n = await handle.write(value.subarray(offset));
        if (!Number.isInteger(n) || n <= 0 || n > value.byteLength - offset) {
          throw new Error('The destination did not accept all export bytes.');
        }
        offset += n;
      }
    }
    signal?.throwIfAborted();
    await handle.close();
    closed = true;
    complete = true;
  } finally {
    if (!complete) {
      try { await reader.cancel(); } catch { /* The original write failure still matters. */ }
      if (!closed) { try { await handle.close(); } catch { /* Best effort close. */ } }
      try { await removeIncomplete(); } catch { /* Never hide the original write error. */ }
    }
    reader.releaseLock();
  }
}

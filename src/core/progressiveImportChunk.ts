/**
 * Import up to one bounded chunk concurrently, publishing each successfully
 * finished photo as soon as its EXIF and preview registrations are complete.
 *
 * The returned array is ALWAYS in source order (including null failures),
 * even if the fastest photo finished last in the input list. This separation
 * keeps stable capture identities and final burst grouping independent of
 * I/O scheduling and makes a slow NEF unable to hold back its ready neighbours.
 */
export async function completeImportChunk<Input, Output>(
  entries: readonly Input[],
  read: (entry: Input, sourceIndex: number) => Promise<Output | null>,
  onReady?: (value: Output) => void,
): Promise<Array<Output | null>> {
  let accepting = true;
  try {
    return await Promise.all(entries.map(async (entry, index) => {
      const finished = await read(entry, index);
      if (accepting && finished !== null) onReady?.(finished);
      return finished;
    }));
  } finally {
    // A rejected worker cannot publish late completions from its siblings.
    // Earlier successful arrivals are left intact for a partial import.
    accepting = false;
  }
}

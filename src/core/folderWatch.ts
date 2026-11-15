import { isSupportedPhotoFilename } from '../providers/localShootLoader';

/**
 * Watching a folder for photos that arrive from outside: a tethering tool, a camera sending over Wi-Fi or FTP, or a card
 * being copied in. A file is only handed over once it has stopped growing, so a photo still being written is never read
 * half-finished.
 */
export interface Listing { name: string; size: number; modified: number }

export interface WatchState {
  /** Names already handed over, or deliberately skipped at the start. */
  done: Set<string>;
  /** Last size seen for files that are still arriving. */
  seen: Map<string, string>;
}

export const startWatching = (existing: Listing[], includeExisting: boolean): WatchState => ({
  done: new Set(includeExisting ? [] : existing.map((entry) => entry.name)),
  seen: new Map(),
});

/** One look at the folder. Returns the files ready to import now; call again on the next look. */
export function lookAgain(state: WatchState, listing: Listing[]): Listing[] {
  const ready: Listing[] = [];
  for (const entry of listing) {
    if (state.done.has(entry.name) || !isSupportedPhotoFilename(entry.name) || entry.name.startsWith('.')) continue;
    const fingerprint = `${entry.size}:${entry.modified}`;
    if (entry.size > 0 && state.seen.get(entry.name) === fingerprint) {
      state.done.add(entry.name);
      state.seen.delete(entry.name);
      ready.push(entry);
    } else {
      state.seen.set(entry.name, fingerprint);
    }
  }
  // Forget files that vanished before they finished (a cancelled transfer).
  for (const name of [...state.seen.keys()]) if (!listing.some((entry) => entry.name === name)) state.seen.delete(name);
  return ready.sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name));
}

/** A read can race with a camera still transferring a file. Never import it unless
 * its size and modified timestamp agree before, during and after the read. */
export function matchesStableTransfer(expected: Listing, file: Pick<File, 'size' | 'lastModified'>, after: Listing | undefined): boolean {
  return Boolean(after && expected.name === after.name && expected.size > 0 &&
    expected.size === file.size && expected.size === after.size &&
    expected.modified === file.lastModified && expected.modified === after.modified);
}

/**
 * Hot folder: watch a folder that a camera maker's own tether app (or InFlight's FTP inbox) writes into, and import each
 * new photograph once it has finished arriving. Pure: the caller lists the folder; this decides what is ready.
 *
 * A file is ready only when two looks in a row see the same size and modified time, so a frame still being written is
 * never imported half-done. Hidden files, partial downloads and anything that is not a photo are left alone. Nothing in
 * the folder is ever moved, renamed or written.
 */

export interface HotFolderFile {
  /** Stable identity inside the folder: the full path on the desktop app, the relative name in a browser. */
  key: string;
  name: string;
  size: number;
  lastModified: number;
}

export interface HotFolderState {
  /** What the last look saw, by key, so the next look can tell whether a file has stopped growing. */
  lastSeen: ReadonlyMap<string, { size: number; lastModified: number }>;
  /** Files already handed to import (or deliberately skipped); never offered again while watching. */
  handled: ReadonlySet<string>;
}

export const emptyHotFolderState = (): HotFolderState => ({ lastSeen: new Map(), handled: new Set() });

/** Names tether apps, browsers and FTP servers use while a file is still being written, plus system clutter. */
const PARTIAL = /\.(?:tmp|temp|part|partial|crdownload|download|filepart|inprogress|lock)$/i;

export function isHotFolderCandidate(name: string, photoExtensions: ReadonlySet<string>): boolean {
  if (!name || name.startsWith('.') || name.startsWith('~') || name.startsWith('._')) return false;
  if (PARTIAL.test(name)) return false;
  const extension = name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : '';
  return photoExtensions.has(extension);
}

export interface HotFolderLook {
  /** Settled photographs not yet imported, oldest first, so frames arrive in the order they were shot. */
  ready: HotFolderFile[];
  /** Photographs seen but still being written (size or time changed since the last look, or empty). */
  arriving: number;
  next: HotFolderState;
}

/** One look at the folder. Call it every couple of seconds with the folder's current listing. */
export function lookAtHotFolder(state: HotFolderState, listing: readonly HotFolderFile[], photoExtensions: ReadonlySet<string>): HotFolderLook {
  const lastSeen = new Map<string, { size: number; lastModified: number }>();
  const ready: HotFolderFile[] = [];
  let arriving = 0;
  for (const file of listing) {
    if (!isHotFolderCandidate(file.name, photoExtensions)) continue;
    lastSeen.set(file.key, { size: file.size, lastModified: file.lastModified });
    if (state.handled.has(file.key)) continue;
    const before = state.lastSeen.get(file.key);
    const settled = before !== undefined && file.size > 0 && before.size === file.size && before.lastModified === file.lastModified;
    if (settled) ready.push(file);
    else arriving++;
  }
  ready.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
  return { ready, arriving, next: { lastSeen, handled: state.handled } };
}

/** Record files as handed to import, so the next look does not offer them again. */
export function markHotFolderHandled(state: HotFolderState, keys: Iterable<string>): HotFolderState {
  const handled = new Set(state.handled);
  for (const key of keys) handled.add(key);
  return { lastSeen: state.lastSeen, handled };
}

import { openLinkedRange, type RangeBlob } from './rangeBlob';
import { PHOTO_EXTENSIONS } from '../core/rawFormats';
import { isDesktopApp } from './desktopShell';
import { discoverPhotoPaths } from './nativeFolderDiscovery';

/**
 * A photo Kestrel knows about without holding it: where it is, and how to read it when it is needed.
 * On the desktop app photos stay where they are on the disk and are read from there on demand, instead of
 * being copied into the app's own storage. In a browser a picked file has no path, so it is wrapped as it is.
 */
export interface PickedPhoto {
  name: string;
  size: number;
  lastModified: number;
  /** Where the original lives on the disk (desktop app only). Never written to. */
  path?: string;
  read(): Promise<File>;
}

export const pickedFromFile = (file: File): PickedPhoto => ({
  name: file.name, size: file.size, lastModified: file.lastModified, read: async () => file,
});

/** The same key the app has always used for a photo, so projects made before this change still match. */
export const pickedKey = (photo: Pick<PickedPhoto, 'name' | 'size' | 'lastModified'>) =>
  `local-file://${photo.name}::${photo.size}::${photo.lastModified}`;

const extensions = PHOTO_EXTENSIONS.map((entry) => entry.replace(/^\./, ''));
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** A photo that lives at this path, read from the disk each time it is needed. */
export async function linkedPhoto(path: string): Promise<PickedPhoto> {
  const fs = await import('@tauri-apps/plugin-fs');
  const info = await fs.stat(path);
  const name = baseName(path);
  const lastModified = info.mtime ? info.mtime.getTime() : 0;
  return {
    name, size: info.size, lastModified, path,
    async read() { return new File([await fs.readFile(path)], name, { lastModified }); },
  };
}

/**
 * Is the file now at a linked path still the photo that was imported? Size must match when it is known.
 * The modified time is deliberately NOT compared with the import time: Reconnect accepts a file whose name and size
 * match but whose modified time changed (copied, re-downloaded, restored from backup), and FAT/exFAT cards and NAS
 * shares round times by up to two seconds. Rejecting those would make reconnected photos refuse to open.
 */
export function linkedSourceMatches(expectedSize: number | undefined, actualSize: number): boolean {
  if (!Number.isSafeInteger(actualSize) || actualSize < 0) return false;
  if (expectedSize === undefined) return true;
  return Number.isSafeInteger(expectedSize) && expectedSize > 0 && expectedSize === actualSize;
}

/** Reader for a photo already in a project, given its saved path and the name, size and time it had when added. */
export function linkedReader(path: string, name: string, lastModified: number, expectedSize?: number): () => Promise<File> {
  return async () => {
    const fs = await import('@tauri-apps/plugin-fs');
    // A path can be reused by a different photo after a card is reimported.
    const before = await fs.stat(path);
    if (!linkedSourceMatches(expectedSize, before.size)) {
      throw new Error('Linked original differs from the imported photo. Reconnect the original before editing.');
    }
    const bytes = await fs.readFile(path);
    // A file can change while it is being read. Do not silently return changed bytes.
    const after = await fs.stat(path);
    if (before.size !== after.size || bytes.byteLength !== after.size ||
        (before.mtime && after.mtime && before.mtime.getTime() !== after.mtime.getTime())) {
      throw new Error('Linked original changed during reading. Retry or reconnect the original.');
    }
    return new File([bytes], name, { lastModified });
  };
}

export interface LinkedRange {
  blob: RangeBlob;
  /** True when the file still has the size and modified time it had when opened (it did not change while being read). */
  verify(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Ranged reader for a linked original: only the bytes asked for are read (a RAW's embedded preview is a few MB of a
 * 30-60 MB file, which matters on external drives and network shares). Same identity rule as linkedReader.
 */
export function linkedRangeOpener(path: string, expectedSize?: number): () => Promise<LinkedRange> {
  return async () => {
    const fs = await import('@tauri-apps/plugin-fs');
    const before = await fs.stat(path);
    if (!linkedSourceMatches(expectedSize, before.size)) {
      throw new Error('Linked original differs from the imported photo. Reconnect the original before editing.');
    }
    const range = await openLinkedRange(path, before.size);
    return {
      blob: range.blob,
      close: range.close,
      verify: async () => {
        const after = await fs.stat(path);
        return after.size === before.size && !(before.mtime && after.mtime && before.mtime.getTime() !== after.mtime.getTime());
      },
    };
  };
}

/** Ask the desktop app to choose photos. They are linked, not copied. */
export async function pickPhotosNatively(): Promise<PickedPhoto[] | 'cancelled'> {
  if (!isDesktopApp()) return 'cancelled';
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ multiple: true, directory: false, title: 'Choose photos', filters: [{ name: 'Photos', extensions }] });
  const paths = Array.isArray(chosen) ? chosen : typeof chosen === 'string' ? [chosen] : [];
  if (!paths.length) return 'cancelled';
  return Promise.all(paths.map(linkedPhoto));
}

/** Choose a folder and link photographs throughout its nested shoot folders.
 * Metadata reads are bounded; original bytes are still read only when needed.
 */
export async function pickFolderNatively(options: {
  /** Called once a folder is chosen, before the (possibly long) look through it, so progress can show at once. */
  onChosen?: () => void;
  /** Photos found so far and how many have been looked at; total is known once the folder has been listed. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
} = {}): Promise<PickedPhoto[] | 'cancelled'> {
  if (!isDesktopApp()) return 'cancelled';
  const { open } = await import('@tauri-apps/plugin-dialog');
  const fs = await import('@tauri-apps/plugin-fs');
  const chosen = await open({ directory: true, multiple: false, recursive: true, title: 'Choose a folder of photos' });
  if (typeof chosen !== 'string') return 'cancelled';
  options.onChosen?.();
  const discovery = await discoverPhotoPaths(chosen, fs.readDir, new Set(extensions));
  if (options.signal?.aborted) return 'cancelled';
  if (discovery.truncated || discovery.skippedFolders) {
    // Never silently import only part of a shoot when the scan was incomplete.
    throw new Error(discovery.truncated
      ? 'This folder contains more photos than Kestrel can safely scan at once. Choose a smaller shoot folder.'
      : 'Some folders could not be read. Check drive permissions and try again.');
  }
  // Limit concurrent filesystem metadata requests for large camera cards/NAS volumes.
  const photos: PickedPhoto[] = [];
  for (let index = 0; index < discovery.paths.length; index += 8) {
    if (options.signal?.aborted) return 'cancelled';
    const batch = await Promise.all(discovery.paths.slice(index, index + 8).map(linkedPhoto));
    photos.push(...batch);
    options.onProgress?.(photos.length, discovery.paths.length);
  }
  return photos;
}

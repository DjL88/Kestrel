import { exportFolderName } from './exportBatchQueue';
import { safeExportName } from './exportPlace';
import { writeExclusiveBlob, type ExclusiveWriteHandle } from './exclusiveExportWrite';

/**
 * The native shell supplies path joining and exclusive filesystem access.
 * Nothing is uploaded; export files go only beneath the folder picked by the photographer.
 */
export interface DesktopExportIO {
  join(...segments: string[]): Promise<string>;
  mkdir(path: string): Promise<void>;
  openExclusive(path: string): Promise<ExclusiveWriteHandle>;
  removeIncomplete(path: string): Promise<void>;
}

function safePart(value: string): boolean {
  if (!value || value !== value.trim() || /[. ]$/.test(value) ||
      /[\u0000-\u001f<>:"\/\\|?*]/.test(value) || value === '.' || value === '..') return false;
  // Windows treats these device names as reserved even when followed by an extension.
  return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value);
}

/** A user-selected destination for an app-lifetime serial export job. */
export function createDesktopFolderDestination(root: string, io: DesktopExportIO) {
  return {
    folder: root,
    async save(file: File, subfolder: string, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      if (!safePart(file.name) || safeExportName(file.name) !== file.name) {
        throw new Error('This export has an unsafe filename. No file was written.');
      }
      if (subfolder && (!safePart(subfolder) || exportFolderName(subfolder) !== subfolder)) {
        throw new Error('This export has an unsafe destination folder. No file was written.');
      }
      const destination = subfolder ? await io.join(root, subfolder) : root;
      if (subfolder) await io.mkdir(destination);
      signal.throwIfAborted();
      const path = await io.join(destination, file.name);
      signal.throwIfAborted();
      // openExclusive must use createNew. It never truncates an existing file.
      // The writer removes only its own partial file when cancellation or I/O fails.
      await writeExclusiveBlob(
        file, () => io.openExclusive(path), () => io.removeIncomplete(path), signal,
      );
    },
  };
}

import { PHOTO_EXTENSIONS } from '../core/rawFormats';
import { assignBurstGroups } from '../core/cullingEngine';
import { parseImageExif } from '../core/exifParser';
import type { PhotoFrame, ShootDescriptor } from '../core/types';
import type { BrowserCatalogueStore } from './browserCatalogueStore';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { linkedReader, pickedFromFile, pickedKey, type PickedPhoto } from './linkedOriginals';
import { checkOriginalPaths } from './originalPathStatus';
import { isDesktopApp } from './desktopShell';

const SUPPORTED_EXTENSIONS = new Set(PHOTO_EXTENSIONS);

export function isSupportedPhotoFilename(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return false;
  return SUPPORTED_EXTENSIONS.has(lower.slice(dot));
}

export function getLocalFileKey(file: File): string {
  return `local-file://${file.name}::${file.size}::${file.lastModified}`;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export interface LocalLoadProgress {
  frames: PhotoFrame[];
  loaded: number;
  total: number;
}

export async function loadLocalFileListShoot(
  files: Array<File | PickedPhoto>,
  previewProvider: BrowserPreviewProvider,
  store: BrowserCatalogueStore,
  onProgress?: (progress: LocalLoadProgress) => void,
  options: { allowPartial?: boolean } = {},
): Promise<{ shoot: ShootDescriptor; frames: PhotoFrame[]; storedAllBlobs: boolean; unstoredKeys: string[]; uncachedPreviewKeys: string[]; failedNames: string[] }> {
  const validFiles = files
    .map((f) => (f instanceof File ? pickedFromFile(f) : f))
    .filter((f) => isSupportedPhotoFilename(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const shootId = `local-files-${Date.now()}`;
  const rawFrames: PhotoFrame[] = [];
  const unstoredKeys: string[] = [];
  const uncachedPreviewKeys: string[] = [];
  const failedNames: string[] = [];

  // Manual imports preserve the rest of a shoot if an original is inaccessible.
  // Watched imports remain atomic: the watcher retries the whole selection when
  // a transfer temporarily fails, and successful files are deduplicated later.
  const allowPartial = options.allowPartial !== false;
  const BATCH_SIZE = validFiles.some((photo) => photo.path) ? 4 : 12;
  for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
    const chunk = validFiles.slice(i, i + BATCH_SIZE);
    const processed = await Promise.all(
      chunk.map(async (file, offset): Promise<PhotoFrame | null> => {
        const idx = i + offset + 1;
        const stableKey = pickedKey(file);
        let opened: File;
        try {
          opened = await file.read();
          // A file that changed while being opened is not the chosen original.
          // Never show a stale/corrupt half-transfer as a successfully imported photo.
          if (opened.size !== file.size || opened.lastModified !== file.lastModified) {
            throw new Error('Photo changed while being imported.');
          }
        } catch {
          return null;
        }
        if (file.path) {
          // Stays where it is on the disk: nothing is copied into the app, and it is read again when needed.
          previewProvider.registerLinked(stableKey, { read: linkedReader(file.path, file.name, file.lastModified, file.size), size: file.size, lastModified: file.lastModified });
          try {
            if (!await previewProvider.cacheOfflinePreviews(stableKey, file.name, opened)) uncachedPreviewKeys.push(stableKey);
          } catch {
            uncachedPreviewKeys.push(stableKey);
          }
        } else {
          previewProvider.registerBlob(stableKey, opened);
          const saved = await store.saveLocalFileBlob(stableKey, opened);
          if (!saved) {
            unstoredKeys.push(stableKey);
            try {
              if (!await previewProvider.cacheOfflinePreviews(stableKey, file.name, opened)) uncachedPreviewKeys.push(stableKey);
            } catch {
              uncachedPreviewKeys.push(stableKey);
            }
          }
        }

        const exif = await parseImageExif(opened, file.name);
        if (!exif.capturedAtMs && file.lastModified) {
          exif.capturedAtMs = file.lastModified;
        }

        const frame: PhotoFrame = {
          id: `file-${idx}-${file.name}`,
          stableKey,
          filename: file.name,
          sequenceIndex: idx,
          decision: exif.rejectedByMetadata ? 'reject' : 'unreviewed',
          burstGroupId: null,
          burstIndex: 1,
          burstCount: 1,
          exif,
          isDemo: false,
          sourceKind: 'file',
          ...(file.path ? { sourcePath: file.path } : {}),
        };
        return frame;
      })
    );

    for (let index = 0; index < processed.length; index += 1) {
      if (processed[index] === null) failedNames.push(chunk[index].name);
      else rawFrames.push(processed[index]!);
    }
    onProgress?.({
      frames: assignBurstGroups(rawFrames),
      loaded: rawFrames.length,
      total: validFiles.length,
    });

    // Yield to browser paint loop for smooth progressive grid updates
    await new Promise((r) => setTimeout(r, 0));
  }

  if (failedNames.length && !allowPartial) {
    throw new Error('Some watched photos could not be read. The watcher will retry.');
  }
  const grouped = assignBurstGroups(rawFrames);
  const now = Date.now();
  const shoot: ShootDescriptor = {
    id: shootId,
    title:
      validFiles.length === 1
        ? validFiles[0].name
        : `Local Import (${validFiles.length} files)`,
    sourceKind: 'local-files',
    totalFrames: grouped.length,
    needsFileReselect: unstoredKeys.length > 0,
    createdAt: now,
    lastUpdatedAt: now,
  };

  return { shoot, frames: grouped, storedAllBlobs: unstoredKeys.length === 0, unstoredKeys, uncachedPreviewKeys, failedNames };
}

export async function readFilesFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle
): Promise<{ name: string; file: File; relativePath: string }[]> {
  const entries: { name: string; file: File; relativePath: string }[] = [];

  // Single-level folder scan (safe and predictable for a shoot folder)
  for await (const [, handle] of (
    dirHandle as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries()) {
    if (handle.kind === 'file' && isSupportedPhotoFilename(handle.name)) {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      entries.push({
        name: file.name,
        file,
        relativePath: `${dirHandle.name}/${file.name}`,
      });
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return entries;
}

export async function loadDirectoryHandleShoot(
  dirHandle: FileSystemDirectoryHandle,
  previewProvider: BrowserPreviewProvider,
  store: BrowserCatalogueStore,
  onProgress?: (progress: LocalLoadProgress) => void,
  options?: {
    /** Catalogue project that owns this folder permission. */
    handleKey?: string;
    /** Reuse an already enumerated folder so the picker path is only walked once. */
    entries?: Awaited<ReturnType<typeof readFilesFromDirectoryHandle>>;
  }
): Promise<{ shoot: ShootDescriptor; frames: PhotoFrame[] }> {
  const entries = options?.entries ?? await readFilesFromDirectoryHandle(dirHandle);
  const shootId = `local-folder-${dirHandle.name}`;
  await store.saveDirectoryHandle(options?.handleKey ?? shootId, dirHandle);

  const rawFrames: PhotoFrame[] = [];
  const BATCH_SIZE = 16;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);
    const processed = await Promise.all(
      chunk.map(async (entry, offset) => {
        const idx = i + offset + 1;
        const stableKey = `folder://${entry.relativePath}`;
        previewProvider.registerBlob(stableKey, entry.file);

        const exif = await parseImageExif(entry.file, entry.name);
        if (!exif.capturedAtMs && entry.file.lastModified) {
          exif.capturedAtMs = entry.file.lastModified;
        }

        const frame: PhotoFrame = {
          id: `dir-${idx}-${entry.name}`,
          stableKey,
          filename: entry.name,
          sequenceIndex: idx,
          decision: exif.rejectedByMetadata ? 'reject' : 'unreviewed',
          burstGroupId: null,
          burstIndex: 1,
          burstCount: 1,
          exif,
          isDemo: false,
          sourceKind: 'directory-handle',
        };
        return frame;
      })
    );

    rawFrames.push(...processed);
    onProgress?.({
      frames: assignBurstGroups(rawFrames),
      loaded: rawFrames.length,
      total: entries.length,
    });

    await new Promise((r) => setTimeout(r, 0));
  }

  const grouped = assignBurstGroups(rawFrames);
  const now = Date.now();
  const shoot: ShootDescriptor = {
    id: shootId,
    title: dirHandle.name,
    folderName: dirHandle.name,
    sourceKind: 'local-folder',
    totalFrames: grouped.length,
    needsFolderRegrant: false,
    createdAt: now,
    lastUpdatedAt: now,
  };

  return { shoot, frames: grouped };
}

/** The size and modified time a photo had when it was added are part of its key: local-file://name::size::time. */
const keyParts = (key: string) => key.split('::');
const sizeOf = (key: string) => Number(keyParts(key).at(-2)) || 0;
const lastModifiedOf = (key: string) => Number(keyParts(key).at(-1)) || 0;

export async function rehydrateLocalFramesFromStore(
  frames: PhotoFrame[],
  previewProvider: BrowserPreviewProvider,
  store: BrowserCatalogueStore
): Promise<boolean> {
  // Photos that stayed on the disk are linked again from their saved path, so nothing has to be copied or re-picked.
  for (const frame of frames) {
    if (frame.sourcePath && !previewProvider.hasBlob(frame.stableKey)) {
      previewProvider.registerLinked(frame.stableKey, {
        read: linkedReader(frame.sourcePath, frame.filename, lastModifiedOf(frame.stableKey), sizeOf(frame.stableKey) || undefined),
        size: sizeOf(frame.stableKey), lastModified: lastModifiedOf(frame.stableKey),
      });
    }
  }
  const missing = [...new Set(frames.filter((frame) => !frame.isDemo).map((frame) => frame.stableKey))]
    .filter((key) => !previewProvider.hasBlob(key));
  let allFound = true;
  for (let offset = 0; offset < missing.length; offset += 12) {
    const restored = await Promise.all(missing.slice(offset, offset + 12).map(async (key) => {
      const blob = await store.loadLocalFileBlob(key);
      if (blob) previewProvider.registerBlob(key, blob);
      return Boolean(blob);
    }));
    if (restored.some((found) => !found)) allFound = false;
  }
  // A registered reader is not proof that its saved path is still accessible.
  // Use metadata-only native checks, bounded across the project, without opening NEF bytes.
  if (isDesktopApp()) {
    const paths = frames.filter((frame) => !frame.isDemo && frame.sourcePath).map((frame) => frame.sourcePath!);
    if (paths.length) {
      const { stat } = await import('@tauri-apps/plugin-fs');
      const statuses = await checkOriginalPaths(paths, stat);
      if ([...statuses.values()].some((status) => status !== 'available')) allFound = false;
    }
  }
  return allFound;
}

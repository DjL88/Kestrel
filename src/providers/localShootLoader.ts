import { assignBurstGroups } from '../core/cullingEngine';
import { parseImageExif } from '../core/exifParser';
import type { PhotoFrame, ShootDescriptor } from '../core/types';
import type { BrowserCatalogueStore } from './browserCatalogueStore';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.nef']);

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
  files: File[],
  previewProvider: BrowserPreviewProvider,
  store: BrowserCatalogueStore,
  onProgress?: (progress: LocalLoadProgress) => void
): Promise<{ shoot: ShootDescriptor; frames: PhotoFrame[]; storedAllBlobs: boolean }> {
  const validFiles = files
    .filter((f) => isSupportedPhotoFilename(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  await store.clearLocalFileBlobs();

  const shootId = `local-files-${Date.now()}`;
  const rawFrames: PhotoFrame[] = [];
  let storedAllBlobs = true;

  const BATCH_SIZE = 12;
  for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
    const chunk = validFiles.slice(i, i + BATCH_SIZE);
    const processed = await Promise.all(
      chunk.map(async (file, offset) => {
        const idx = i + offset + 1;
        const stableKey = getLocalFileKey(file);
        previewProvider.registerBlob(stableKey, file);
        const saved = await store.saveLocalFileBlob(stableKey, file);
        if (!saved) storedAllBlobs = false;

        const exif = await parseImageExif(file, file.name);
        if (!exif.capturedAtMs && file.lastModified) {
          exif.capturedAtMs = file.lastModified;
        }

        const frame: PhotoFrame = {
          id: `file-${idx}-${file.name}`,
          stableKey,
          filename: file.name,
          sequenceIndex: idx,
          decision: 'unreviewed',
          burstGroupId: null,
          burstIndex: 1,
          burstCount: 1,
          exif,
          isDemo: false,
          sourceKind: 'file',
        };
        return frame;
      })
    );

    rawFrames.push(...processed);
    onProgress?.({
      frames: assignBurstGroups(rawFrames),
      loaded: rawFrames.length,
      total: validFiles.length,
    });

    // Yield to browser paint loop for smooth progressive grid updates
    await new Promise((r) => setTimeout(r, 0));
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
    needsFileReselect: !storedAllBlobs,
    createdAt: now,
    lastUpdatedAt: now,
  };

  return { shoot, frames: grouped, storedAllBlobs };
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
  onProgress?: (progress: LocalLoadProgress) => void
): Promise<{ shoot: ShootDescriptor; frames: PhotoFrame[] }> {
  const entries = await readFilesFromDirectoryHandle(dirHandle);
  const shootId = `local-folder-${dirHandle.name}`;
  await store.saveDirectoryHandle(shootId, dirHandle);

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
          decision: 'unreviewed',
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

export async function rehydrateLocalFramesFromStore(
  frames: PhotoFrame[],
  previewProvider: BrowserPreviewProvider,
  store: BrowserCatalogueStore
): Promise<boolean> {
  let allFound = true;
  for (const frame of frames) {
    if (frame.isDemo) continue;
    if (previewProvider.hasBlob(frame.stableKey)) continue;
    const blob = await store.loadLocalFileBlob(frame.stableKey);
    if (blob) {
      previewProvider.registerBlob(frame.stableKey, blob);
    } else {
      allFound = false;
    }
  }
  return allFound;
}

/**
 * Find the XMP sidecar an editing app left beside a photo, and add what it says to the photo's edit status. Read only:
 * the sidecar and the original are never written. Used at import and by the background fill for older photos.
 */
import { addSidecarEditStatus } from '../core/exifParser';
import { MAX_SIDECAR_STATUS_BYTES, sidecarFilenames, type EditStatus } from '../core/editStatus';
import { isDesktopApp } from './desktopShell';

export interface SidecarSource { name: string; read(): Promise<Blob> }

/** The .xmp files among the chosen files (a folder pick includes them), by lower-case name. */
export function sidecarIndex(files: ReadonlyArray<Blob & { name: string } | SidecarSource>): Map<string, SidecarSource> {
  const index = new Map<string, SidecarSource>();
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.xmp')) continue;
    index.set(file.name.toLowerCase(), file instanceof Blob ? { name: file.name, read: async () => file } : file);
  }
  return index;
}

/** The desktop app reads a sidecar next to a linked original on the disk, when there is one. */
async function siblingOnDisk(path: string, names: string[]): Promise<Blob | null> {
  if (!isDesktopApp()) return null;
  const fs = await import('@tauri-apps/plugin-fs');
  const folder = path.replace(/[^/\\]+$/, '');
  for (const name of names) {
    const candidate = folder + name;
    try {
      if (!await fs.exists(candidate)) continue;
      const info = await fs.stat(candidate);
      if (!info.isFile || info.size === 0 || info.size > MAX_SIDECAR_STATUS_BYTES) continue;
      return new Blob([await fs.readFile(candidate)]);
    } catch {
      // Outside the app's reach or gone: the status stays as the photo's own file says.
    }
  }
  return null;
}

export async function findSidecar(filename: string, path: string | undefined, index?: Map<string, SidecarSource>): Promise<Blob | null> {
  const names = sidecarFilenames(filename);
  for (const name of names) {
    const source = index?.get(name.toLowerCase());
    if (source) return source.read().catch(() => null);
  }
  return path ? siblingOnDisk(path, names).catch(() => null) : null;
}

/** The status with the sidecar's evidence added; unchanged when there is no sidecar or it cannot be read. */
export async function editStatusWithSidecar(status: EditStatus | undefined, filename: string, path?: string, index?: Map<string, SidecarSource>): Promise<EditStatus | undefined> {
  if (!status) return status;
  return addSidecarEditStatus(status, await findSidecar(filename, path, index).catch(() => null));
}

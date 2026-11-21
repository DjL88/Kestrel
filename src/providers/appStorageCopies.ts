import { isDesktopApp } from './desktopShell';

/**
 * Photos added on a phone or tablet app come from the system's picker, which gives the app a temporary copy it can never
 * read again after a restart. So the app keeps its own copy in its private storage, and the project links to that copy
 * like a desktop project links to a file on the disk. The original in Photos or Files is only read, never changed or moved.
 *
 * Not used on desktop (the file stays where it is and is linked in place), and not for a photo that can be reached again
 * where it is (`PickedPhoto.reconnectable`, for example a photo that comes from a connected network drive).
 */
export function appCopiesAvailable(): boolean {
  if (!isDesktopApp() || typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  // iPadOS reports a Mac, so touch tells it apart from a real Mac.
  return /iPhone|iPad|iPod|Android/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
}

const FOLDER = 'photos';
const CHUNK = 4 * 1024 * 1024;

/** A name that is safe as one path segment. */
const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'photo';

async function base(): Promise<string> {
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  return join(await appDataDir(), FOLDER);
}

/**
 * Copy one photo into the app's private storage, in pieces so a large RAW is never held in memory twice.
 * Returns the path of the copy, or null if it could not be written (the caller then falls back to the browser database).
 */
export async function copyIntoAppStorage(stableKey: string, file: Blob, name: string): Promise<string | null> {
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const folder = await join(await base(), safe(stableKey));
    await fs.mkdir(folder, { recursive: true });
    const path = await join(folder, safe(name));
    const handle = await fs.open(path, { write: true, create: true, truncate: true });
    try {
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        await handle.write(new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer()));
      }
    } finally {
      await handle.close();
    }
    // Only a complete copy counts: the project will treat this path as the photo.
    const written = await fs.stat(path);
    return written.size === file.size ? path : null;
  } catch {
    return null;
  }
}

/** Bytes the app's own copies use, for the Settings line. Null when this device keeps none. */
export async function appCopiesSize(): Promise<number | null> {
  if (!appCopiesAvailable()) return null;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const root = await base();
    if (!(await fs.exists(root))) return 0;
    let total = 0;
    for (const folder of await fs.readDir(root)) {
      if (!folder.isDirectory) continue;
      for (const entry of await fs.readDir(await join(root, folder.name))) {
        if (entry.isFile) total += (await fs.stat(await join(root, folder.name, entry.name))).size;
      }
    }
    return total;
  } catch {
    return null;
  }
}

/** Remove the app's copies for photos that no project uses any more (called when a project is deleted). */
export async function removeAppCopies(stableKeys: Iterable<string>): Promise<void> {
  if (!appCopiesAvailable()) return;
  try {
    const fs = await import('@tauri-apps/plugin-fs');
    const { join } = await import('@tauri-apps/api/path');
    const root = await base();
    for (const key of stableKeys) {
      const folder = await join(root, safe(key));
      if (await fs.exists(folder)) await fs.remove(folder, { recursive: true });
    }
  } catch { /* a copy that cannot be removed now is only wasted space, never a lost photo */ }
}

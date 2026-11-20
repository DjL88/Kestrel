import { isDesktopApp, isMobileShell } from './desktopShell';
import { BrowserCatalogueStore } from './browserCatalogueStore';
import { desktopFolderConnector, directoryHandleConnector } from './folderConnector';
import type { StorageConnector } from '../core/storageConnectors';
import type { CullingState } from '../core/types';

/**
 * Backup destination when the photographer has not chosen a separate one:
 * - A writable desktop/source folder saves within that folder's kestrel/v1 tree.
 * - A phone or photo collection without folder write access stays on this device (OPFS).
 * Never requests new permissions while saving, changes the originals or sends data online.
 */
export const LOCAL_RECOVERY_TARGET = '@kestrel-device-or-photo-folder';

export type RecoveryLocation =
  | { connector: StorageConnector; to: string }
  | { problem: 'missing' | 'needs-signin'; message: string };

/** Only use the source folder when EVERY real source is linked there. */
export function sharedOriginalFolder(paths: readonly (string | undefined)[]): string | null {
  if (!paths.length || paths.some(path => !path || !/[/\\]/.test(path))) return null;
  const folders = paths.map(path => path!.slice(0, Math.max(path!.lastIndexOf('/'), path!.lastIndexOf('\\'))));
  const first = folders[0];
  return first && folders.every(folder => folder === first) ? first : null;
}

function mobileDevice(): boolean {
  if (isMobileShell()) return true;
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export async function openLocalRecovery(state: CullingState): Promise<RecoveryLocation> {
  const mobile = mobileDevice();
  if (!mobile && isDesktopApp()) {
    const photos = state.frames.filter(frame => !frame.isDemo && !frame.virtualCopy && frame.sourceKind === 'file');
    const folder = sharedOriginalFolder(photos.map(frame => frame.sourcePath));
    if (folder) {
      try {
        return { connector: await desktopFolderConnector(folder), to: 'Photo folder' };
      } catch { /* Continue using private local recovery storage. */ }
    }
  }

  // Browser folder pickers normally give READ permission. Never prompt for
  // write permission during autosave; use it only if already granted.
  if (!mobile && !isDesktopApp() && state.shoot.sourceKind === 'local-folder') {
    try {
      const handle = await new BrowserCatalogueStore().loadDirectoryHandle(state.shoot.id);
      const permission = await (handle as (FileSystemDirectoryHandle & {
        queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
      }) | null)?.queryPermission?.({ mode: 'readwrite' });
      if (handle && permission === 'granted')
        return { connector: directoryHandleConnector(handle), to: 'Photo folder' };
    } catch { /* The photo folder may be disconnected. Local recovery remains available. */ }
  }

  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
      return { problem: 'missing', message: 'Project changes are saved in Kestrel, but this device does not support separate local recovery files.' };
    const handle = await navigator.storage.getDirectory();
    return { connector: directoryHandleConnector(handle), to: 'On this device' };
  } catch {
    return { problem: 'needs-signin', message: 'Project changes are saved in Kestrel, but the local recovery folder is unavailable.' };
  }
}

import { isDesktopApp } from './desktopShell';
import { BrowserCatalogueStore } from './browserCatalogueStore';
import { desktopFolderConnector, directoryHandleConnector } from './folderConnector';
import { openConnection } from './connectionStore';
import { getLocations } from './projectLocations';
import type { StorageConnector } from '../core/storageConnectors';
import type { CullingState } from '../core/types';

/**
 * Backup behaviour follows the photograph's writable SOURCE, not the device.
 * Always make an on-device recovery snapshot; when the source is writable,
 * also keep a rolling snapshot alongside it (including NAS from mobile).
 * Never prompt for new folder permission from an unattended backup.
 */
export const LOCAL_RECOVERY_TARGET = '@kestrel-device-or-photo-folder';

export type RecoveryLocation =
  | { connector: StorageConnector; to: string }
  | { problem: 'missing' | 'needs-signin'; message: string };

/** Only write beside originals when every original belongs to the same folder. */
export function sharedOriginalFolder(paths: readonly (string | undefined)[]): string | null {
  if (!paths.length || paths.some(path => !path || !/[/\\]/.test(path))) return null;
  const folders = paths.map(path => path!.slice(0, Math.max(path!.lastIndexOf('/'), path!.lastIndexOf('\\'))));
  const first = folders[0];
  return first && folders.every(folder => folder === first) ? first : null;
}

/** Private Kestrel storage (OPFS), not the phone's photos or an external drive. */
export async function openDeviceRecovery(): Promise<RecoveryLocation> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
      return { problem: 'missing', message: 'Separate device recovery storage is unavailable; the catalogue still saves inside Kestrel.' };
    return { connector: directoryHandleConnector(await navigator.storage.getDirectory()), to: 'On this device' };
  } catch {
    return { problem: 'needs-signin', message: 'The local recovery directory is unavailable; the catalogue still saves inside Kestrel.' };
  }
}

/**
 * Obtain an existing writable location for the original images, on any OS.
 * Desktop file paths, browser folder handles and connected NAS/cloud sources
 * all work when access has already been granted. Otherwise return null.
 */
export async function openSourceRecovery(state: CullingState): Promise<RecoveryLocation | null> {
  const originals = state.frames.filter(frame => !frame.isDemo && !frame.virtualCopy && frame.removedAt == null);
  if (originals.length && isDesktopApp() && originals.every(frame => frame.sourceKind === 'file')) {
    const folder = sharedOriginalFolder(originals.map(frame => frame.sourcePath));
    if (folder) {
      try {
        const connector = await desktopFolderConnector(folder);
        if ((await connector.test()).ok) return { connector, to: 'Photo folder' };
      } catch { /* Might be a read-only or disconnected network drive. */ }
    }
  }

  // File-system handles can represent local *or network* folders, including
  // those opened from mobile. Never ask for permission during automatic saves.
  if (state.shoot.sourceKind === 'local-folder' && originals.some(frame => frame.sourceKind === 'directory-handle')) {
    try {
      const handle = await new BrowserCatalogueStore().loadDirectoryHandle(state.shoot.id);
      const permission = await (handle as (FileSystemDirectoryHandle & {
        queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>
      }) | null)?.queryPermission?.({ mode: 'readwrite' });
      if (handle && permission === 'granted') {
        const connector = directoryHandleConnector(handle);
        if ((await connector.test()).ok) return { connector, to: 'Photo folder' };
      }
    } catch { /* Fall back to private local storage; the originals are untouched. */ }
  }

  // A source connection can be a NAS reached through WebDAV, mounted folder,
  // or another existing connection. On phones this works the same as desktop.
  const sourceId = getLocations(state.shoot.id).loadFrom;
  if (sourceId && originals.length) {
    try {
      const opened = await openConnection(sourceId);
      if (!('problem' in opened) && (await opened.connector.test()).ok)
        return { connector: opened.connector, to: 'Photo source' };
    } catch { /* The remote source may be offline or read-only. */ }
  }
  return null;
}

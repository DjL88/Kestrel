import { encodeProjectBackup } from '../core/projectBackup';
import type { CullingState } from '../core/types';
import { downloadExport } from './browserExport';
import { isDesktopApp, saveWithDialog } from './desktopShell';

interface BackupFileHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}

export async function saveProjectBackupFile(state: CullingState): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const filename = (state.shoot.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || 'InFlight') + '.kestrel.json';
  const data = new Blob([encodeProjectBackup(state)], { type: 'application/json' });
  // A desktop backup is complete only when the chosen file has been written.
  // Cancellation and write errors must reach the caller, especially before deleting a project.
  if (isDesktopApp()) return await saveWithDialog(data, filename) ? 'saved' : 'cancelled';

  const picker = (window as Window & {
    showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<BackupFileHandle>;
  }).showSaveFilePicker;

  if (picker) {
    let handle: BackupFileHandle | undefined;
    try {
      handle = await picker.call(window, {
        suggestedName: filename,
        types: [{ description: 'InFlight project backup', accept: { 'application/json': ['.json'] } }],
      });
    } catch (reason) {
      const name = (reason as Error).name;
      if (name === 'AbortError') return 'cancelled';
      if (name !== 'SecurityError' && name !== 'NotAllowedError') throw reason;
    }
    if (handle) {
      const stream = await handle.createWritable();
      try {
        await stream.write(data);
        await stream.close();
      } catch (reason) {
        await stream.abort().catch(() => {});
        throw reason;
      }
      return 'saved';
    }
  }
  downloadExport(data, filename);
  return 'downloaded';
}

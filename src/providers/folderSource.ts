import type { Listing } from '../core/folderWatch';
import { isDesktopApp } from './desktopShell';

/** A folder InFlight can look at and read photos from. It never writes, renames or deletes anything in it. */
export interface FolderSource { name: string; list(): Promise<Listing[]>; read(name: string): Promise<File> }
export type PickedSource = FolderSource | 'cancelled' | 'unsupported';

function handleSource(root: FileSystemDirectoryHandle): FolderSource {
  const cache = new Map<string, Listing>();
  return {
    name: root.name,
    async list() {
      const out: Listing[] = [];
      for await (const [name, entry] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (entry.kind !== 'file') continue;
        // Asking for a file's details is the slow part, so files already known to be finished are not asked about again.
        const file = await (entry as FileSystemFileHandle).getFile();
        const listing = { name, size: file.size, modified: file.lastModified };
        cache.set(name, listing);
        out.push(listing);
      }
      return out;
    },
    async read(name) { return (await root.getFileHandle(name)).getFile(); },
  };
}

async function desktopSource(root: string): Promise<FolderSource> {
  const fs = await import('@tauri-apps/plugin-fs');
  const join = (name: string) => `${root.replace(/[\\/]+$/, '')}/${name}`;
  return {
    name: root.split(/[\\/]/).filter(Boolean).at(-1) ?? 'the folder',
    async list() {
      const out: Listing[] = [];
      for (const entry of await fs.readDir(root)) {
        if (!entry.isFile) continue;
        const info = await fs.stat(join(entry.name));
        out.push({ name: entry.name, size: info.size, modified: info.mtime ? info.mtime.getTime() : 0 });
      }
      return out;
    },
    async read(name) {
      const bytes = await fs.readFile(join(name));
      const info = await fs.stat(join(name));
      return new File([bytes], name, { lastModified: info.mtime ? info.mtime.getTime() : Date.now() });
    },
  };
}

export async function pickWatchFolder(): Promise<PickedSource> {
  if (isDesktopApp()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const chosen = await open({ directory: true, multiple: false, title: 'Choose the folder to watch' });
    return typeof chosen === 'string' ? desktopSource(chosen) : 'cancelled';
  }
  const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return 'unsupported';
  try { return handleSource(await picker.call(window, { mode: 'read' })); }
  catch (error) { if ((error as Error).name === 'AbortError') return 'cancelled'; throw error; }
}

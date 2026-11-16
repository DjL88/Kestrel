import { isInsideSyncRoot, isWritablePath, type StorageConnector } from '../core/storageConnectors';
import { isDesktopApp } from './desktopShell';

export interface PickedFolder { connector: StorageConnector; name: string; /** The folder's path, in the desktop app. */ path?: string; /** The folder's handle, in a browser. */ handle?: FileSystemDirectoryHandle }
export type PickResult = PickedFolder | 'cancelled' | 'unsupported';

const parts = (path: string) => path.split('/').filter(Boolean);
const guardWrite = (path: string) => { if (!isWritablePath(path)) throw new Error('Path is outside the Kestrel folder.'); };
const guard = (path: string) => { if (!isInsideSyncRoot(path.replace(/\/+$/, ''))) throw new Error('Path is outside the Kestrel folder.'); };

/** A folder opened with the browser's folder picker (Chrome, Edge, and anything else that supports it). */
export function directoryHandleConnector(root: FileSystemDirectoryHandle): StorageConnector {
  async function dir(path: string[], create: boolean) {
    let current = root;
    for (const part of path) current = await current.getDirectoryHandle(part, { create });
    return current;
  }
  async function walk(handle: FileSystemDirectoryHandle, prefix: string, out: string[]) {
    for await (const [name, entry] of (handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind === 'directory') await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`, out);
      else out.push(`${prefix}${name}`);
    }
  }
  return {
    kind: 'folder',
    async test() { try { await root.getDirectoryHandle('.kestrel-test', { create: true }); await root.removeEntry('.kestrel-test'); return { ok: true as const }; } catch { return { ok: false as const, reason: 'Kestrel cannot write to that folder. Choose another, or allow access when asked.' }; } },
    async put(path, bytes) {
      guardWrite(path);
      const segments = parts(path);
      const file = await (await dir(segments.slice(0, -1), true)).getFileHandle(segments.at(-1)!, { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(bytes as unknown as BufferSource);
        await writable.close();
      } catch (error) {
        // Discard the staged replacement and release the handle after a failed
        // write or commit. Cleanup must never hide the original storage error.
        try { await writable.abort(); } catch { /* the drive may have disconnected */ }
        throw error;
      }
    },
    async get(path) {
      guard(path);
      const segments = parts(path);
      try { return new Uint8Array(await (await (await (await dir(segments.slice(0, -1), false)).getFileHandle(segments.at(-1)!)).getFile()).arrayBuffer()); } catch { return null; }
    },
    async list(prefix) {
      guard(prefix);
      const out: string[] = [];
      try { await walk(await dir(parts(prefix), false), `${prefix.replace(/\/+$/, '')}/`, out); } catch { /* nothing there yet */ }
      return out.sort();
    },
    async remove(path) {
      guard(path);
      const segments = parts(path);
      try { await (await dir(segments.slice(0, -1), false)).removeEntry(segments.at(-1)!); } catch { /* already gone */ }
    },
  };
}

/** A folder chosen in the desktop app, read and written through the system's own permission to that folder only. */
export async function desktopFolderConnector(root: string): Promise<StorageConnector> {
  const fs = await import('@tauri-apps/plugin-fs');
  const join = (path: string) => `${root.replace(/[\\/]+$/, '')}/${path}`;
  return {
    kind: 'folder',
    async test() { try { await fs.mkdir(join('kestrel/v1'), { recursive: true }); return { ok: true as const }; } catch { return { ok: false as const, reason: 'Kestrel cannot write to that folder. Choose another.' }; } },
    async put(path, bytes) {
      guardWrite(path);
      await fs.mkdir(join(parts(path).slice(0, -1).join('/')), { recursive: true });
      await fs.writeFile(join(path), bytes);
    },
    async get(path) { guard(path); try { return await fs.readFile(join(path)); } catch { return null; } },
    async list(prefix) {
      guard(prefix);
      const base = prefix.replace(/\/+$/, '');
      try { return (await fs.readDir(join(base))).filter((entry) => entry.isFile).map((entry) => `${base}/${entry.name}`).sort(); } catch { return []; }
    },
    async remove(path) { guard(path); try { await fs.remove(join(path)); } catch { /* already gone */ } },
  };
}

/** Ask the person for a folder. Desktop uses the system dialog; browsers use the folder picker where it exists. */
export async function pickSyncFolder(): Promise<PickResult> {
  if (isDesktopApp()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const chosen = await open({ directory: true, multiple: false, title: 'Choose a sync folder' });
    if (typeof chosen !== 'string') return 'cancelled';
    return { connector: await desktopFolderConnector(chosen), path: chosen, name: chosen.split(/[\\/]/).filter(Boolean).at(-1) ?? 'the folder' };
  }
  const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return 'unsupported';
  try {
    const handle = await picker.call(window, { mode: 'readwrite' });
    return { connector: directoryHandleConnector(handle), name: handle.name, handle };
  } catch (error) {
    if ((error as Error).name === 'AbortError') return 'cancelled';
    throw error;
  }
}

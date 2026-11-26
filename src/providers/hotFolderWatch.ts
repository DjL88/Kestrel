import { emptyHotFolderState, lookAtHotFolder, markHotFolderHandled, type HotFolderFile, type HotFolderState } from '../core/hotFolder';
import { PHOTO_EXTENSIONS } from '../core/rawFormats';
import { isDesktopApp } from './desktopShell';
import { folderNameOf, linkedPhoto, type PickedPhoto } from './linkedOriginals';
import { discoverPhotoPaths } from './nativeFolderDiscovery';

/**
 * Watch a folder that photographs arrive in while shooting (a maker's tether app, a card reader's auto-copy, InFlight's
 * own FTP inbox) and hand each finished frame to import. The desktop app links frames where they land (never copied);
 * a browser that can keep a folder open (Chrome, Edge) reads them through that folder. Read-only on both.
 */
export interface HotFolderSource {
  /** The folder's name, to say what is being watched. */
  name: string;
  /** The photographs in the folder now; `skip` are keys already imported, so they need not be looked at again. */
  list(skip: ReadonlySet<string>): Promise<HotFolderFile[]>;
  /** The photo for a listed file, ready for import. */
  open(file: HotFolderFile): Promise<PickedPhoto>;
}

export const PHOTO_EXTENSION_SET: ReadonlySet<string> = new Set(PHOTO_EXTENSIONS.map((entry) => entry.replace(/^\./, '').toLowerCase()));

/** A folder on this computer, by path (desktop app). Used directly by the FTP inbox, which already knows its folder. */
export function desktopHotFolder(folder: string): HotFolderSource {
  return {
    name: folderNameOf(folder),
    async list(skip) {
      const fs = await import('@tauri-apps/plugin-fs');
      // Tether apps often make dated subfolders; a few levels is plenty and keeps each look quick.
      const found = await discoverPhotoPaths(folder, fs.readDir, PHOTO_EXTENSION_SET, { maxDepth: 3 });
      const fresh = found.paths.filter((path) => !skip.has(path));
      const files: HotFolderFile[] = [];
      for (let index = 0; index < fresh.length; index += 8) {
        const batch = await Promise.all(fresh.slice(index, index + 8).map(async (path) => {
          try {
            const info = await fs.stat(path);
            return { key: path, name: folderNameOf(path), size: info.size, lastModified: info.mtime ? info.mtime.getTime() : 0 };
          } catch { return null; } // removed between listing and looking: it simply is not there
        }));
        for (const entry of batch) if (entry) files.push(entry);
      }
      return files;
    },
    open: (file) => linkedPhoto(file.key),
  };
}

type DirectoryHandle = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

/** A folder chosen in a browser that can keep it open between looks. */
export function browserHotFolder(handle: FileSystemDirectoryHandle): HotFolderSource {
  const files = new Map<string, File>();
  async function walk(dir: DirectoryHandle, prefix: string, depth: number, skip: ReadonlySet<string>, out: HotFolderFile[]) {
    for await (const entry of dir.values()) {
      const key = prefix + entry.name;
      if (entry.kind === 'directory') {
        if (depth < 3) await walk(entry as DirectoryHandle, `${key}/`, depth + 1, skip, out);
      } else if (!skip.has(key)) {
        try {
          const file = await (entry as FileSystemFileHandle).getFile();
          files.set(key, file);
          out.push({ key, name: file.name, size: file.size, lastModified: file.lastModified });
        } catch { /* still being written or removed: looked at again next time */ }
      }
    }
  }
  return {
    name: handle.name,
    async list(skip) { const out: HotFolderFile[] = []; await walk(handle as DirectoryHandle, '', 0, skip, out); return out; },
    async open(file) {
      const picked = files.get(file.key);
      if (!picked) throw new Error(`${file.name} is no longer in the folder.`);
      return { name: picked.name, size: picked.size, lastModified: picked.lastModified, read: async () => picked };
    },
  };
}

/** Can this device watch a folder? The desktop app always can; a browser needs the folder-picker that keeps access. */
export const canWatchFolder = () => isDesktopApp() || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);

/** Ask the person for the folder to watch. Null when they cancel. */
export async function chooseHotFolder(): Promise<HotFolderSource | null> {
  if (isDesktopApp()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const chosen = await open({ directory: true, multiple: false, recursive: true, title: 'Choose the folder your photos arrive in' });
    return typeof chosen === 'string' ? desktopHotFolder(chosen) : null;
  }
  const picker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return null;
  try { return browserHotFolder(await picker({ mode: 'read' })); }
  catch { return null; } // cancelled
}

export interface HotFolderStatus { imported: number; arriving: number; problem: boolean }

/**
 * Look at the folder every `intervalMs` until `signal` aborts. `onReady` imports the frames and says whether it took
 * them; frames it could not take (an import was already running) are offered again on the next look, never dropped.
 */
export function watchHotFolder(source: HotFolderSource, options: {
  signal: AbortSignal;
  onReady: (photos: PickedPhoto[]) => Promise<boolean>;
  onStatus: (status: HotFolderStatus) => void;
  intervalMs?: number;
}): void {
  let state: HotFolderState = emptyHotFolderState();
  let imported = 0;
  const interval = options.intervalMs ?? 2000;
  const tick = async () => {
    if (options.signal.aborted) return;
    try {
      const listing = await source.list(state.handled);
      const look = lookAtHotFolder(state, listing, PHOTO_EXTENSION_SET);
      state = look.next;
      if (look.ready.length && !options.signal.aborted) {
        const photos = (await Promise.all(look.ready.map((file) => source.open(file).catch(() => null))));
        const opened = look.ready.filter((_, index) => photos[index]);
        if (opened.length && await options.onReady(photos.filter((photo): photo is PickedPhoto => photo !== null))) {
          state = markHotFolderHandled(state, opened.map((file) => file.key));
          imported += opened.length;
        }
      }
      options.onStatus({ imported, arriving: look.arriving, problem: false });
    } catch {
      // The drive was unplugged or the folder went away: say so and keep looking, so the shoot resumes when it is back.
      options.onStatus({ imported, arriving: 0, problem: true });
    }
    if (!options.signal.aborted) setTimeout(() => { void tick(); }, interval);
  };
  void tick();
}

import { writeExclusiveBlob } from '../core/exclusiveExportWrite';
/** True when Kestrel is running inside the desktop app rather than a browser tab. */
export const isDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The app shell on a phone or tablet (Tauri mobile). It has no native RAW commands; it uses the WebAssembly pipeline. */
export const isMobileShell = () => isDesktopApp() && typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Kestrel's RAW pipeline is compiled into this shell natively (Windows, macOS, Linux). Same code as the WebAssembly one. */
export const hasNativeRaw = () => isDesktopApp() && !isMobileShell();

const extensionOf = (name: string) => name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';

/**
 * Ask where to save with the system's own dialog, then write the file there. Returns false if the person cancelled.
 * The app can write only the place they chose.
 */
export async function saveWithDialog(blob: Blob, name: string, requireMatchingExtension = false): Promise<boolean> {
  const [{ save }, { open, remove }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
  const extension = extensionOf(name);
  const path = await save({ defaultPath: name, filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined });
  if (!path) return false;
  if (requireMatchingExtension && extensionOf(path.split(/[\\/]/).at(-1) ?? '') !== extension) {
    throw new Error(`Choose a filename ending in .${extension}.`);
  }
  // Never overwrite an existing photograph or export, even when the save
  // dialog returns an already-used filename. createNew is atomic at open time.
  // Stream large TIFFs instead of allocating another full-size byte array.
  // On a phone the system's picker has already made (and the person has already confirmed) an empty file at this path, so
  // an exclusive create fails there and leaves a zero-byte file with "Could not save file". Write into it instead.
  await writeExclusiveBlob(blob, () => open(path, isMobileShell() ? { write: true, truncate: true } : { write: true, createNew: true }), () => remove(path));
  // Show the saved file in Finder or Explorer. Saving has still worked if this fails.
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    void revealItemInDir(path).catch(() => {});
  } catch { /* The file has already been saved. */ }
  return true;
}


/**
 * An explicitly selected local desktop folder. A unique run folder makes
 * repeated exports independent, with each output opened exclusively.
 * The app-lifetime task queue owns the files after the export dialog closes.
 */
export async function chooseDesktopExportFolder() {
  if (!isDesktopApp() || isMobileShell()) throw new Error('Folder-based background export needs the desktop app.');
  const [{ open: choose }, { open: openFile, mkdir, remove }, { join }, { createDesktopFolderDestination }, { exportRunFolder }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
    import('../core/desktopExportFolder'),
    import('../core/exportPlace'),
  ]);
  const chosen = await choose({ directory: true, multiple: false, title: 'Choose where to save Kestrel exports' });
  if (typeof chosen !== 'string' || !chosen) return null; // Folder picker cancelled.
  const folder = exportRunFolder(new Date(), crypto.randomUUID()).slice('export/'.length);
  const root = await join(chosen, 'Kestrel Exports', folder);
  await mkdir(root, { recursive: true });
  return createDesktopFolderDestination(root, {
    join: (...parts) => join(...parts),
    mkdir: async path => { await mkdir(path, { recursive: true }); },
    openExclusive: path => openFile(path, { write: true, createNew: true }),
    removeIncomplete: async path => { await remove(path); },
  });
}

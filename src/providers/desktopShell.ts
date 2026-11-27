import { requireEmptyExportHandle, writeExclusiveBlob } from '../core/exclusiveExportWrite';
/** True when InFlight is running inside the desktop app rather than a browser tab. */
export const isDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The app shell on a phone or tablet (Tauri mobile). It has no native RAW commands; it uses the WebAssembly pipeline. */
export const isMobileShell = () => isDesktopApp() && typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** InFlight's RAW pipeline is compiled into this shell natively (Windows, macOS, Linux). Same code as the WebAssembly one. */
export const hasNativeRaw = () => isDesktopApp() && !isMobileShell();

const extensionOf = (name: string) => name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';

/**
 * Ask where to save with the system's own dialog, then write the file there. Returns false if the person cancelled.
 * The app can write only the place they chose.
 */
export async function saveWithDialog(blob: Blob, name: string, requireMatchingExtension = false, signal?: AbortSignal, options: { startInExports?: boolean } = {}): Promise<boolean> {
  const [{ save }, { open, remove }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
  const extension = extensionOf(name);
  // An export starts where the last export went, else Pictures\InFlight Exports, else Pictures: never in whichever
  // folder the system last browsed, which was often the originals' own (Dave, 27 Nov: a ZIP offered D:\Photos\...).
  const start = options.startInExports ? await exportStartFolder() : undefined;
  const defaultPath = start ? await import('@tauri-apps/api/path').then(({ join }) => join(start, name)).catch(() => name) : name;
  const path = await save({ defaultPath, filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined });
  signal?.throwIfAborted();
  if (!path) return false;
  if (options.startInExports) {
    const { parentFolder, rememberExportFolder } = await import('../core/exportFolderChoice');
    const folder = parentFolder(path);
    if (folder) rememberExportFolder(typeof localStorage === 'undefined' ? null : localStorage, folder);
  }
  if (requireMatchingExtension && extensionOf(path.split(/[\\/]/).at(-1) ?? '') !== extension) {
    throw new Error(`Choose a filename ending in .${extension}.`);
  }
  // Never overwrite an existing photograph or export, even when the save
  // dialog returns an already-used filename. createNew is atomic at open time.
  // Stream large TIFFs instead of allocating another full-size byte array.
  // Mobile pickers can reserve an empty file. Inspect the opened handle before
  // writing, so a provider returning an existing photograph cannot truncate it.
  const openOutput = async () => isMobileShell()
    ? requireEmptyExportHandle(await open(path, { write: true }))
    : open(path, { write: true, createNew: true });
  await writeExclusiveBlob(blob, openOutput, () => remove(path), signal);
  // Show the saved file in Finder or Explorer. Saving has still worked if this fails.
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    void revealItemInDir(path).catch(() => {});
  } catch { /* The file has already been saved. */ }
  return true;
}


/** Where an export's Save As starts: see saveStartFolder. Undefined leaves it to the system. */
async function exportStartFolder(): Promise<string | undefined> {
  try {
    const { lastExportFolder, saveStartFolder } = await import('../core/exportFolderChoice');
    const last = lastExportFolder(typeof localStorage === 'undefined' ? null : localStorage);
    if (last) return last;
    const { pictureDir, join } = await import('@tauri-apps/api/path');
    const pictures = await pictureDir();
    const inflightExports = await join(pictures, 'InFlight Exports');
    const inflightExportsExists = await import('@tauri-apps/plugin-fs').then(({ exists }) => exists(inflightExports)).catch(() => false);
    return saveStartFolder({ pictures, inflightExports, inflightExportsExists });
  } catch {
    return undefined;
  }
}

/**
 * An explicitly selected local desktop folder. A unique run folder makes
 * repeated exports independent, with each output opened exclusively.
 * The app-lifetime task queue owns the files after the export dialog closes.
 */
/**
 * clickedAt: when the person pressed Save files. The folder picker's timing is then left as a finished task in Tasks on
 * this device (src/core/pickerTiming.ts), so a slow picker can be told apart from a slow app. Nothing is sent anywhere.
 */
export async function chooseDesktopExportFolder(clickedAt?: number) {
  if (!isDesktopApp() || isMobileShell()) throw new Error('Folder-based background export needs the desktop app.');
  const [{ open: choose }, { open: openFile, mkdir, remove }, { join }, { createDesktopFolderDestination }, { exportRunFolder }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
    import('../core/desktopExportFolder'),
    import('../core/exportPlace'),
  ]);
  const { lastExportFolder, rememberExportFolder, reasonOf } = await import('../core/exportFolderChoice');
  const { engineText } = await import('../i18n/areas/engine');
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  // recursive: the export writes into "InFlight Exports/<run>" inside the chosen folder, so the grant must cover the
  // folders inside it too; without it the app refused to make them ("Could not start this export").
  const askedAt = Date.now();
  const chosen = await choose({ directory: true, multiple: false, recursive: true, defaultPath: lastExportFolder(storage), title: 'Choose where to save InFlight exports' });
  if (clickedAt !== undefined) {
    const { pickerDurations } = await import('../core/pickerTiming');
    const durations = pickerDurations({ clickedAt, askedAt, answeredAt: Date.now() });
    if (durations) {
      const { tasks } = await import('../core/taskStore');
      tasks.start(engineText.workspace.pickerTimingTitle).finish(engineText.workspace.pickerTiming(durations.appSeconds, durations.pickerSeconds));
    }
  }
  if (typeof chosen !== 'string' || !chosen) return null; // Folder picker cancelled.
  const folder = exportRunFolder(new Date(), crypto.randomUUID()).slice('export/'.length);
  const root = await join(chosen, 'InFlight Exports', folder);
  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    throw new Error(engineText.workspace.exportFolderUnwritable(chosen, reasonOf(error)));
  }
  rememberExportFolder(storage, chosen);
  return createDesktopFolderDestination(root, {
    join: (...parts) => join(...parts),
    mkdir: async path => { await mkdir(path, { recursive: true }); },
    openExclusive: path => openFile(path, { write: true, createNew: true }),
    removeIncomplete: async path => { await remove(path); },
  });
}

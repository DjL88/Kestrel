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
  await writeExclusiveBlob(blob, () => open(path, { write: true, createNew: true }), () => remove(path));
  // Show the saved file in Finder or Explorer. Saving has still worked if this fails.
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    void revealItemInDir(path).catch(() => {});
  } catch { /* The file has already been saved. */ }
  return true;
}

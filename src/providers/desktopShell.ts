/** True when Kestrel is running inside the desktop app rather than a browser tab. */
export const isDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const extensionOf = (name: string) => name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';

/**
 * Ask where to save with the system's own dialog, then write the file there. Returns false if the person cancelled.
 * The app can write only the place they chose.
 */
export async function saveWithDialog(blob: Blob, name: string): Promise<boolean> {
  const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
  const extension = extensionOf(name);
  const path = await save({ defaultPath: name, filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  // Show the saved file in Finder or Explorer. Saving has still worked if this fails.
  try { (await import('@tauri-apps/plugin-opener')).revealItemInDir(path); } catch { /* ignore */ }
  return true;
}

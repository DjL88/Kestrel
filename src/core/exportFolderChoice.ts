/**
 * Desktop "Save to a folder": the picked folder and the words shown when it can't be used. Pure, so it is tested.
 *
 * The owner's test: the export failed with "Could not start this export", the real reason hidden (the desktop app
 * rejects with plain text, not an Error), and the picker opened in the originals' folder. The likely cause was the
 * folder grant: the picker allowed the chosen folder but not folders inside it, so making "InFlight Exports/<run>"
 * there was refused. The picker now grants the folder and everything in it, and starts where the last export went.
 */
export const LAST_EXPORT_FOLDER_KEY = 'inflight.lastExportFolder';

/** Where the folder picker should start: the folder the last export went to, if one was remembered. */
export function lastExportFolder(storage: Pick<Storage, 'getItem'> | null | undefined): string | undefined {
  try {
    const value = storage?.getItem(LAST_EXPORT_FOLDER_KEY)?.trim();
    return value && value.length < 4096 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function rememberExportFolder(storage: Pick<Storage, 'setItem'> | null | undefined, folder: string): void {
  try { storage?.setItem(LAST_EXPORT_FOLDER_KEY, folder); } catch { /* private mode or full: the picker starts at its default */ }
}

/** The reason in plain text, whatever was thrown: an Error, the desktop app's plain-text rejection, or nothing useful. */
export function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === 'string') return error.trim();
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message.trim();
  return '';
}

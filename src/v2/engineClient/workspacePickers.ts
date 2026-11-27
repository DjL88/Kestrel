/** The file and folder pickers the V2 workspace opens: the browser's inputs, or the desktop app's system dialogs. Originals are only linked, never copied. */
import { PHOTO_ACCEPT } from '../../core/rawFormats';
import { isDesktopApp } from '../../providers/desktopShell';
import { engineText } from '../../i18n/areas/engine';
import { tasks, type TaskHandle } from '../../core/taskStore';
import { folderNameOf, pickFolderNatively, pickPhotosNatively, type PickedPhoto } from '../../providers/linkedOriginals';

export async function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true;
    input.setAttribute('data-testid', 'v2-watermark-input');
    document.body.appendChild(input);
    const done = (file: File | null) => { input.remove(); resolve(file); };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Pick a local folder through the webview's directory input. Import uses the same verified catalogue loader. */
export async function pickFolderFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = PHOTO_ACCEPT;
    input.setAttribute('webkitdirectory', '');
    input.hidden = true;
    input.setAttribute('data-testid', 'v2-folder-input');
    document.body.appendChild(input);
    const done = (files: File[] | null) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(input.files?.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/**
 * Pick a folder of photos. On the desktop app the system folder dialog links every photo by its path, so originals stay
 * where they are and are never copied; the browser reads them through the directory input. `name` is the folder's name.
 */
export async function pickFolderPhotos(onProblem: (message: string) => void): Promise<{ picks: Array<File | PickedPhoto>; name?: string } | null> {
  if (isDesktopApp()) {
    let name: string | undefined;
    // From the moment the folder is chosen, Tasks shows the look-through running (its wheel and the edge stripe move),
    // with Cancel: on a big folder on an external drive this wait used to show nothing at all for minutes.
    let looking: TaskHandle | null = null;
    const stop = new AbortController();
    try {
      const chosen = await pickFolderNatively({
        signal: stop.signal,
        onChosen: (folder) => {
          name = folderNameOf(folder);
          looking = tasks.start(engineText.workspace.folderLooking(name), { kind: 'import', cancel: () => stop.abort() });
        },
        onProgress: (done, total) => looking?.progress(done, total, engineText.workspace.folderLookingProgress(name ?? '', done, total)),
      });
      (looking as TaskHandle | null)?.finish();
      return chosen === 'cancelled' || !chosen.length ? null : { picks: chosen, name };
    } catch (error) {
      // An incomplete scan is refused rather than importing part of a shoot.
      const message = error instanceof Error ? error.message : String(error);
      (looking as TaskHandle | null)?.fail(message);
      onProblem(message);
      return null;
    }
  }
  const files = await pickFolderFiles();
  if (!files?.length) return null;
  return { picks: files, name: (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] };
}

export async function pickFiles(): Promise<Array<File | PickedPhoto> | null> {
  if (isDesktopApp()) {
    const chosen = await pickPhotosNatively();
    return chosen === 'cancelled' ? null : chosen;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = PHOTO_ACCEPT; input.hidden = true;
    input.setAttribute('data-testid', 'v2-file-input');
    document.body.appendChild(input);
    const done = (files: File[] | null) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(input.files?.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Pick replacement files for originals the catalogue can no longer read (moved, renamed, or the browser session
 * lost its blob). Browser-only: the desktop app picks a folder instead (see reconnectOriginal). */
export async function pickReselectFiles(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.accept = PHOTO_ACCEPT; input.hidden = true;
    input.setAttribute('data-testid', 'v2-relink-input');
    document.body.appendChild(input);
    const done = (files: File[] | null) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(input.files?.length ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

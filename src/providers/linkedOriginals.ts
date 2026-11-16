import { PHOTO_EXTENSIONS } from '../core/rawFormats';
import { isDesktopApp } from './desktopShell';

/**
 * A photo Kestrel knows about without holding it: where it is, and how to read it when it is needed.
 * On the desktop app photos stay where they are on the disk and are read from there on demand, instead of
 * being copied into the app's own storage. In a browser a picked file has no path, so it is wrapped as it is.
 */
export interface PickedPhoto {
  name: string;
  size: number;
  lastModified: number;
  /** Where the original lives on the disk (desktop app only). Never written to. */
  path?: string;
  read(): Promise<File>;
}

export const pickedFromFile = (file: File): PickedPhoto => ({
  name: file.name, size: file.size, lastModified: file.lastModified, read: async () => file,
});

/** The same key the app has always used for a photo, so projects made before this change still match. */
export const pickedKey = (photo: Pick<PickedPhoto, 'name' | 'size' | 'lastModified'>) =>
  `local-file://${photo.name}::${photo.size}::${photo.lastModified}`;

const extensions = PHOTO_EXTENSIONS.map((entry) => entry.replace(/^\./, ''));
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** A photo that lives at this path, read from the disk each time it is needed. */
export async function linkedPhoto(path: string): Promise<PickedPhoto> {
  const fs = await import('@tauri-apps/plugin-fs');
  const info = await fs.stat(path);
  const name = baseName(path);
  const lastModified = info.mtime ? info.mtime.getTime() : 0;
  return {
    name, size: info.size, lastModified, path,
    async read() { return new File([await fs.readFile(path)], name, { lastModified }); },
  };
}

/** Reader for a photo already in a project, given its saved path and the name, size and time it had when added. */
export function linkedReader(path: string, name: string, lastModified: number): () => Promise<File> {
  return async () => {
    const fs = await import('@tauri-apps/plugin-fs');
    return new File([await fs.readFile(path)], name, { lastModified });
  };
}

/** Ask the desktop app to choose photos. They are linked, not copied. */
export async function pickPhotosNatively(): Promise<PickedPhoto[] | 'cancelled'> {
  if (!isDesktopApp()) return 'cancelled';
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ multiple: true, directory: false, title: 'Choose photos', filters: [{ name: 'Photos', extensions }] });
  const paths = Array.isArray(chosen) ? chosen : typeof chosen === 'string' ? [chosen] : [];
  if (!paths.length) return 'cancelled';
  return Promise.all(paths.map(linkedPhoto));
}

/** Ask the desktop app to choose a folder, and link the photos directly inside it. */
export async function pickFolderNatively(): Promise<PickedPhoto[] | 'cancelled'> {
  if (!isDesktopApp()) return 'cancelled';
  const { open } = await import('@tauri-apps/plugin-dialog');
  const fs = await import('@tauri-apps/plugin-fs');
  const chosen = await open({ directory: true, multiple: false, recursive: true, title: 'Choose a folder of photos' });
  if (typeof chosen !== 'string') return 'cancelled';
  const root = chosen.replace(/[\\/]+$/, '');
  const names = (await fs.readDir(root)).filter((entry) => entry.isFile && extensions.includes(entry.name.split('.').at(-1)?.toLowerCase() ?? ''));
  return Promise.all(names.map((entry) => linkedPhoto(`${root}/${entry.name}`)));
}

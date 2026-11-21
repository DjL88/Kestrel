import { useEffect } from 'react';
import { isDesktopApp } from './desktopShell';
import { linkedPhoto, type PickedPhoto } from './linkedOriginals';

/**
 * Photos the system opens with Kite44 (Open With, a double-click, or a file dropped on the app icon) arrive here as
 * saved paths. They are linked, not copied, and handed over as a batch. Does nothing in a browser tab.
 */
export function useOpenedFiles(onPhotos: (photos: PickedPhoto[]) => void) {
  useEffect(() => {
    if (!isDesktopApp()) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    const take = async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      const answer = await invoke<unknown>('take_opened_files').catch(() => null);
      const paths = Array.isArray(answer) ? answer.filter((entry): entry is string => typeof entry === 'string') : [];
      if (stopped || !paths.length) return;
      const photos = (await Promise.all(paths.map((path) => linkedPhoto(path).catch(() => null)))).filter((photo): photo is PickedPhoto => photo !== null);
      if (!stopped && photos.length) onPhotos(photos);
    };
    void import('@tauri-apps/api/event').then(({ listen }) => listen('open-files', () => void take()))
      .then((stop) => { if (stopped) stop(); else unlisten = stop; })
      .catch(() => { /* Without the event channel the photos queued at launch are still picked up below. */ });
    void take().catch(() => {}); // A file that launched the app was queued before this page was listening.
    return () => { stopped = true; unlisten?.(); };
    // The handler is read through a ref by the caller, so listening is set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

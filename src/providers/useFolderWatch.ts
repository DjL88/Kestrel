import { useCallback, useEffect, useRef, useState } from 'react';
import { lookAgain, matchesStableTransfer, startWatching, type WatchState } from '../core/folderWatch';
import type { FolderSource } from './folderSource';

export interface WatchStatus { folder: string; imported: number; error: string | null }
const EVERY_MS = 2000;

/** Look at a chosen folder every couple of seconds and hand over photos as they finish arriving. */
export function useFolderWatch(onFiles: (files: File[]) => void) {
  const [status, setStatus] = useState<WatchStatus | null>(null);
  const run = useRef<{ stop: boolean } | null>(null);
  const handler = useRef(onFiles);
  useEffect(() => { handler.current = onFiles; }, [onFiles]);

  const stop = useCallback(() => { if (run.current) run.current.stop = true; run.current = null; setStatus(null); }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async (source: FolderSource, includeExisting: boolean) => {
    stop();
    const token = { stop: false };
    run.current = token;
    setStatus({ folder: source.name, imported: 0, error: null });
    let state: WatchState;
    try { state = startWatching(await source.list(), includeExisting); }
    catch { if (!token.stop) setStatus({ folder: source.name, imported: 0, error: 'Kestrel cannot read that folder. Choose it again.' }); return; }
    let imported = 0;
    const tick = async () => {
      if (token.stop) return;
      try {
        const ready = lookAgain(state, await source.list());
        if (ready.length) {
          const readFiles = new Map<string, File>();
          for (const entry of ready) {
            try {
              readFiles.set(entry.name, await source.read(entry.name));
            } catch {
              // A file can temporarily vanish or be locked by a camera.
              state.done.delete(entry.name);
              state.seen.delete(entry.name);
            }
          }
          // Re-list once for the whole batch rather than on every image.
          const after = new Map((await source.list()).map((entry) => [entry.name, entry]));
          const files: File[] = [];
          for (const entry of ready) {
            const file = readFiles.get(entry.name);
            if (!file) continue;
            if (!matchesStableTransfer(entry, file, after.get(entry.name))) {
              state.done.delete(entry.name);
              state.seen.delete(entry.name);
              continue;
            }
            files.push(file);
          }
          if (files.length && !token.stop) { handler.current(files); imported += files.length; setStatus({ folder: source.name, imported, error: null }); }
        }
      } catch { if (!token.stop) setStatus({ folder: source.name, imported, error: 'The folder stopped answering. Is the drive still connected?' }); }
      if (!token.stop) window.setTimeout(() => void tick(), EVERY_MS);
    };
    window.setTimeout(() => void tick(), EVERY_MS);
  }, [stop]);

  return { status, start, stop };
}

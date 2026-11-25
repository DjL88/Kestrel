import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  afterFailedRead, externalEditRecord, nextWatchStep, POLL_MS, rememberApp, returnedFileName, startWatch, stepsInEdit,
  workingFileName, type ExternalApp, type ExternalEditRecord, type ExternalEditWatch,
} from '../../core/externalEdit';
import type { PhotoFrame } from '../../core/types';
import {
  bringBack, chooseExternalApp, externalEditorAvailable, loadExternalApps, pngBitDepth, saveExternalApps, sendToExternalApp, stampOf,
} from '../../providers/externalEditor';
import { linkedPhoto, type PickedPhoto } from '../../providers/linkedOriginals';
import { v2Text } from '../../i18n/areas/v2';
import type { WorkspaceStore } from '../ui/contract';

type WatchState = NonNullable<WorkspaceStore['externalEditor']>['watching'][string]['state'];

/**
 * "Edit in another app" for the V2 workspace (desktop only). Renders the current edit, sends it out as a 16-bit TIFF,
 * polls the working file, and imports each settled save as a new photo beside the original. The original photo, its
 * recipe and its file are never changed. Watches last for this session; the TIFF stays in InFlight's working folder.
 */
export function useExternalEdits(deps: {
  frameOf: (photoId: string) => PhotoFrame | undefined;
  /** The current edit of this photo at its own size, as a PNG (16-bit from the 16-bit RAW path, otherwise 8-bit). */
  renderEdit: (frame: PhotoFrame) => Promise<File>;
  /** Import one returned file into the open project, recording where it came from; resolves to false if it was not added. */
  importReturned: (file: PickedPhoto, record: ExternalEditRecord) => Promise<boolean>;
  notify: (message: string) => void;
}) {
  const words = v2Text.externalEdit;
  const available = externalEditorAvailable();
  const [apps, setApps] = useState<ExternalApp[]>(() => (available ? loadExternalApps() : []));
  const [watching, setWatching] = useState<Record<string, { appName: string; state: WatchState; returned: number }>>({});
  const watches = useRef(new Map<string, ExternalEditWatch>());
  const busy = useRef(new Set<string>());
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const show = useCallback((photoId: string, entry: { appName: string; state: WatchState; returned: number } | null) => {
    setWatching((current) => {
      if (!entry) { const { [photoId]: _gone, ...rest } = current; return rest; }
      return { ...current, [photoId]: entry };
    });
  }, []);

  const stop = useCallback((photoId: string, message?: string) => {
    watches.current.delete(photoId);
    show(photoId, null);
    if (message) depsRef.current.notify(message);
  }, [show]);

  const send = useCallback((photoId: string, choice: ExternalApp | 'choose' | 'default') => {
    if (!available) { depsRef.current.notify(words.unavailable); return; }
    if (busy.current.has(photoId)) { depsRef.current.notify(words.busy); return; }
    void (async () => {
      const frame = depsRef.current.frameOf(photoId);
      if (!frame || frame.isDemo) return;
      const app = choice === 'choose' ? await chooseExternalApp().catch(() => null) : choice === 'default' ? null : choice;
      if (choice === 'choose' && !app) return; // picker cancelled
      const appName = app?.name ?? words.defaultAppName;
      busy.current.add(photoId);
      show(photoId, { appName, state: 'sending', returned: 0 });
      try {
        const png = await depsRef.current.renderEdit(frame);
        const sentBits = await pngBitDepth(png);
        const sentAt = Date.now();
        const sent = await sendToExternalApp(png, workingFileName(frame.filename, new Date(sentAt)), app);
        if (app) setApps((current) => { const next = rememberApp(current, app); saveExternalApps(next); return next; });
        watches.current.set(photoId, startWatch({
          frameId: photoId, sourceFilename: frame.filename, app: app ?? { name: appName, path: '' }, tiffPath: sent.path,
          sentAt, sentBits, stepsSent: stepsInEdit(frame), stamp: sent.stamp,
        }));
        show(photoId, { appName, state: 'waiting', returned: 0 });
        depsRef.current.notify(`${words.sent(frame.filename, appName)}${sentBits === 8 ? ` ${words.sentEightBit}` : ''}`);
      } catch (reason) {
        stop(photoId, reason instanceof Error ? reason.message : String(reason));
      } finally {
        busy.current.delete(photoId);
      }
    })();
  }, [available, show, stop, words]);

  const watchCount = Object.keys(watching).length;
  useEffect(() => {
    if (!available || !watchCount) return;
    let live = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        for (const [photoId, before] of [...watches.current]) {
          // Only into the project that holds the original: while another project is open, the save waits.
          if (!live || busy.current.has(photoId) || !depsRef.current.frameOf(photoId)) continue;
          const stamp = await stampOf(before.tiffPath).catch(() => null);
          if (!live || watches.current.get(photoId) !== before) continue;
          const { watch, step } = nextWatchStep(before, stamp, Date.now());
          if (step.kind === 'gone') { stop(photoId, words.gone); continue; }
          if (step.kind === 'expired') { stop(photoId, words.expired); continue; }
          watches.current.set(photoId, watch);
          if (step.kind !== 'bring-back') {
            show(photoId, { appName: watch.app.name, state: step.kind === 'saving' ? 'saving' : 'waiting', returned: watch.returned });
            continue;
          }
          busy.current.add(photoId);
          show(photoId, { appName: watch.app.name, state: 'bringing-back', returned: before.returned });
          try {
            const back = await bringBack(watch.tiffPath, returnedFileName(watch.sourceFilename, watch.app.name, watch.returned));
            const record = externalEditRecord(watch, Date.now(), back.bits);
            const added = await depsRef.current.importReturned(await linkedPhoto(back.path), record);
            if (!added) throw new Error(words.busy);
            show(photoId, { appName: watch.app.name, state: 'waiting', returned: watch.returned });
            depsRef.current.notify(words.returned(back.path.split(/[\\/]/).at(-1) ?? back.path));
          } catch (reason) {
            const retry = stamp ? afterFailedRead(before, stamp, Date.now()) : null;
            if (retry && watches.current.has(photoId)) {
              watches.current.set(photoId, retry);
              show(photoId, { appName: watch.app.name, state: 'saving', returned: before.returned });
            } else {
              stop(photoId, words.unreadable(reason instanceof Error ? reason.message : String(reason)));
            }
          } finally {
            busy.current.delete(photoId);
          }
        }
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [available, watchCount, show, stop, words]);

  const store = useMemo<WorkspaceStore['externalEditor']>(() => (available ? { apps, watching } : null), [available, apps, watching]);
  const stopWatching = useCallback((photoId: string) => {
    const watch = watches.current.get(photoId);
    stop(photoId, watch ? words.stopped(watch.app.name) : undefined);
  }, [stop, words]);
  return { store, editInOtherApp: send, stopExternalEdit: stopWatching };
}

import { useCallback, useEffect, useRef } from 'react';
import { developQueue } from './core/backgroundDevelop';
import { tasks, type TaskHandle } from './core/taskStore';
import type { PhotoFrame } from './core/types';
import type { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import { extractRawPreview } from './core/nefPreview';
import { canDevelopRaw, developRaw, matchPreviewOrientation } from './providers/rawDevelop';

interface Options {
  projectId: string;
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  /** True while the library or culling is showing. Developing pauses while a photo is edited, so the editor goes first. */
  active: boolean;
  /** The photo the person is looking at goes first. */
  onScreen?: string | null;
}

/**
 * After photos are added, develop every RAW from its sensor data with Kestrel's own decoder, one at a time, and keep a
 * screen-sized copy, so the library shows Kestrel's develop rather than the camera's JPEG. Shown in Tasks, where it can
 * be stopped (until the next photos are added). A file that cannot be developed keeps its embedded preview, quietly.
 */
export function useBackgroundDevelop({ projectId, frames, provider, active, onScreen }: Options) {
  const latest = useRef({ projectId, frames, provider, active, onScreen });
  latest.current = { projectId, frames, provider, active, onScreen };
  const running = useRef(false);
  const stoppedFor = useRef<string | null>(null);
  const skipped = useRef(new Set<string>());

  const run = useCallback(async () => {
    if (running.current || !canDevelopRaw()) return;
    running.current = true;
    let task: TaskHandle | null = null;
    let done = 0;
    try {
      for (;;) {
        const { projectId: id, frames: current, provider: store, onScreen: shown } = latest.current;
        const stillCurrent = () => latest.current.active && latest.current.projectId === id && stoppedFor.current !== id;
        if (!store || !stillCurrent()) break;
        const queue = developQueue(current, (frame) => skipped.current.has(`${id}|${frame.stableKey}`), shown);
        if (!queue.length) break;
        const frame = queue[0];
        skipped.current.add(`${id}|${frame.stableKey}`);
        if (await store.developedReview(frame)) continue;
        const original = await store.ensureOriginal(frame.stableKey, 'background');
        if (!original || !stillCurrent()) continue;
        task ??= tasks.start('Developing RAW files with Kestrel', { total: queue.length, cancel: () => { stoppedFor.current = id; } });
        task.progress(done, done + queue.length, frame.filename);
        try {
          const developed = await developRaw(original, /\.([a-z0-9]+)$/i.exec(frame.filename)?.[1] ?? 'nef');
          const turned = await matchPreviewOrientation(developed, await extractRawPreview(original).catch(() => null));
          // The person may have left the project while this one developed; the picture is still right for its original.
          await store.storeDevelopedPicture(frame, turned);
        } catch {
          // Unreadable sensor data: the embedded preview stays, and the editor says why when this photo is opened.
        }
        done += 1;
        task.progress(done, done + queue.length - 1);
      }
    } finally {
      running.current = false;
      if (task) {
        if (stoppedFor.current === latest.current.projectId) task.finish('Stopped; the remaining photos keep the camera preview.');
        else task.finish(`${done} developed`);
      }
    }
  }, []);

  // New photos give a stopped run another go; leaving the project or opening the editor pauses it.
  const count = frames.length;
  useEffect(() => { stoppedFor.current = null; }, [projectId, count]);
  useEffect(() => { if (active) void run(); }, [active, projectId, count, run]);
}

import { useCallback, useEffect, useRef } from 'react';
import { developQueue } from './core/backgroundDevelop';
import { tasks, type TaskHandle } from './core/taskStore';
import type { PhotoFrame } from './core/types';
import type { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import { extractRawPreview } from './core/nefPreview';
import { canDevelopRaw, developRaw, matchPreviewOrientation } from './providers/rawDevelop';
import { appText as t } from './i18n/areas/app';

/** How long after the last photo was added before developing begins. */
const SETTLE_MS = 1500;

interface Options {
  projectId: string;
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  /**
   * True while the app has a project and no import is running. Navigating between Home, Library, Review
   * and Edit must not reset a running background job.
   */
  active: boolean;
  /** The photo the person is looking at goes first. */
  onScreen?: string | null;
}

/**
 * After photos are added, develop every RAW from its sensor data with Kestrel's own decoder, one at a time, and keep a
 * screen-sized copy, so the library shows Kestrel's develop rather than the camera's JPEG. Shown in Tasks as a continuous per-project job, where it can
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
    let processed = 0;
    let developedCount = 0;
    try {
      for (;;) {
        const { projectId: id, frames: current, provider: store, onScreen: shown } = latest.current;
        const stillCurrent = () => latest.current.active && latest.current.projectId === id && stoppedFor.current !== id;
        if (!store || !stillCurrent()) break;
        const queue = developQueue(current, (frame) => skipped.current.has(`${id}|${frame.stableKey}`), shown);
        if (!queue.length) break;
        const frame = queue[0];
        task ??= tasks.start(t.tasks.developingRaw, { total: processed + queue.length, cancel: () => { stoppedFor.current = id; } });
        task.progress(processed, processed + queue.length, frame.filename);
        skipped.current.add(`${id}|${frame.stableKey}`);
        if (await store.developedReview(frame)) {
          processed += 1;
          task.progress(processed, processed + queue.length - 1);
          continue;
        }
        const original = await store.ensureOriginal(frame.stableKey, 'background');
        if (!original || !stillCurrent()) {
          // A missing/unlinked original is not a developed image. Make progress visible
          // without retrying the same unavailable file in a tight loop.
          processed += 1;
          task.progress(processed, processed + queue.length - 1);
          if (!stillCurrent()) break;
          continue;
        }
        try {
          const developed = await developRaw(original, /\.([a-z0-9]+)$/i.exec(frame.filename)?.[1] ?? 'nef');
          const turned = await matchPreviewOrientation(developed, await extractRawPreview(original).catch(() => null));
          if (await store.storeDevelopedPicture(frame, original, turned)) developedCount += 1;
        } catch {
          // Unreadable sensor data: the embedded preview stays, and the editor says why when this photo is opened.
        }
        processed += 1;
        task.progress(processed, processed + queue.length - 1);
        // Give zoom, sliders and input a chance to paint between RAW files.
        // Unlike requestAnimationFrame/idle callbacks, a scheduled task also
        // continues when the window is hidden or the user opens another page.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } finally {
      running.current = false;
      if (task) {
        if (stoppedFor.current === latest.current.projectId) task.finish(t.tasks.developStopped);
        else task.finish(t.tasks.developed(developedCount));
      }
    }
  }, []);

  // New photos give a stopped run another go. Switching between Home, Library, Review and Edit
  // never stops it; only switching projects, importing or explicitly cancelling does.
  // Import goes first because developing reads the full RAW rather than only its preview.
  const count = frames.length;
  useEffect(() => { stoppedFor.current = null; }, [projectId, count]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void run(), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, projectId, count, run]);
}

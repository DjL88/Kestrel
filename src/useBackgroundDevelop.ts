import { useCallback, useEffect, useRef } from 'react';
import { developQueue } from './core/backgroundDevelop';
import { engineScheduler, type SchedulerTicket } from './core/engineScheduler';
import type { PhotoFrame } from './core/types';
import type { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import { extractRawPreview } from './core/nefPreview';
import { canDevelopRaw, developRaw, matchPreviewOrientation } from './providers/rawDevelop';
import { appText as t } from './i18n/areas/app';

const SETTLE_MS = 1500;

interface Options {
  projectId: string;
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  active: boolean;
  onScreen?: string | null;
}

/** One resource-bounded scheduler item per genuine RAW sensor development.
 * A paused/cancelled job never applies a late developed image after its
 * source or project changed; the original is never mutated. */
export function useBackgroundDevelop({ projectId, frames, provider, active, onScreen }: Options) {
  const latest = useRef({ projectId, frames, provider, active, onScreen });
  latest.current = { projectId, frames, provider, active, onScreen };
  const running = useRef(false);
  const ticket = useRef<SchedulerTicket | null>(null);
  const stoppedFor = useRef<string | null>(null);
  const skipped = useRef(new Set<string>());

  const run = useCallback(async () => {
    if (running.current || !canDevelopRaw()) return;
    const { projectId: id, frames: current, provider: source, active: enabled, onScreen: shown } = latest.current;
    if (!enabled || !source || stoppedFor.current === id) return;
    const queue = developQueue(current, frame => skipped.current.has(`${id}|${frame.stableKey}`), shown);
    if (!queue.length) return;
    running.current = true;
    try {
      const submitted = await engineScheduler.submit({
        title: t.tasks.developingRaw, kind: 'raw', resource: 'cpu', location: 'local',
        priority: 2, pauseable: true, items: queue,
        snapshot: { projectId: id, keys: queue.map(frame => frame.stableKey) },
        itemId: frame => frame.stableKey, itemLabel: frame => frame.filename,
        runItem: async (frame, _, ctx) => {
          // Only begin real work when the photo belongs to this active project.
          // Each item can be retried independently without redoing neighbours.
          ctx.checkCancelled();
          if (!latest.current.active || latest.current.projectId !== id) return;
          skipped.current.add(`${id}|${frame.stableKey}`);
          ctx.stage('Checking the cached sensor development');
          if (await source.developedReview(frame)) return;
          ctx.checkCancelled();
          const original = await source.ensureOriginal(frame.stableKey, 'background');
          ctx.checkCancelled();
          if (!original) throw new Error(`Reconnect ${frame.filename} to develop the actual RAW file.`);
          ctx.stage('Developing sensor pixels');
          const developed = await developRaw(original, /\.([a-z0-9]+)$/i.exec(frame.filename)?.[1] ?? 'nef');
          ctx.checkCancelled();
          const turned = await matchPreviewOrientation(developed, await extractRawPreview(original).catch(() => null));
          ctx.checkCancelled();
          ctx.stage('Saving a verified local preview');
          // The provider also checks source revision/epoch and the signal at
          // every awaited cache stage: cancellation cannot apply a late result.
          if (!await source.storeDevelopedPicture(frame, original, turned, ctx.signal))
            throw new Error(`The source for ${frame.filename} changed while developing it.`);
          ctx.checkCancelled();
          // Let zoom, sliders and touch input paint between RAW photographs.
          await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        },
      });
      ticket.current = submitted;
      const outcome = await submitted.finished;
      if (outcome === 'cancelled') stoppedFor.current = id;
    } catch {
      // The Task Manager shows the item-specific error; an unavailable RAW
      // keeps its original embedded review preview and does not corrupt edits.
    } finally {
      running.current = false;
      ticket.current = null;
      const next = latest.current;
      if (next.active && next.projectId === id && stoppedFor.current !== id) {
        // New frames may have arrived while this batch was running. Already
        // attempted frames are excluded so failed files cannot spin forever.
        window.setTimeout(() => { void run(); }, 0);
      }
    }
  }, []);

  const count = frames.length;
  useEffect(() => { stoppedFor.current = null; }, [projectId, count]);
  // Suspend obsolete work when a project changes or the import takes over.
  useEffect(() => {
    if (!active) ticket.current?.cancel();
  }, [active]);
  useEffect(() => () => { ticket.current?.cancel(); }, [projectId]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => { void run(); }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, projectId, count, run]);
}

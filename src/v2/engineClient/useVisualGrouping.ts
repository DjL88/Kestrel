import { useCallback, useEffect, useRef } from 'react';
import { hasCurrentEmbedding, type StoredEmbedding } from '../../core/visualSimilarity';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { pictureForAnalysis } from '../../providers/pictureForAnalysis';
import { embedPicture } from '../../providers/visualEmbedder';
import { runEmbeddingPass } from './embeddingPass';
import { startNotingInput, untilQuiet } from '../../providers/userActivity';

interface Options {
  projectId: string;
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  /** True while the editor is open and no import is running. The pass stops whenever this goes false. */
  active: boolean;
  /** The photo being looked at goes first. */
  onScreen: string | null;
  onEmbedded: (frameId: string, embedding: StoredEmbedding) => void;
  /** Called after each batch so burst groups can be refreshed from the new evidence. */
  onBatchDone: () => void;
  /** Called once when the look-alike model cannot run, with a plain sentence to show. */
  onUnavailable?: (message: string) => void;
}

const BATCH = 12;
/**
 * One embedding takes the page's only thread for a few hundred milliseconds, so it waits until the person has paused this
 * long: culling with the keyboard (about one key a second) then never waits behind it.
 */
const QUIET_MS = 1500;

/** Photos still to embed: live, not yet embedded with the current model, the photo on screen first. */
export function embeddingCandidates(frames: PhotoFrame[], onScreen: string | null, skipped: ReadonlySet<string>): PhotoFrame[] {
  const waiting = frames.filter((frame) => frame.removedAt == null && !hasCurrentEmbedding(frame.visualEmbedding) && !skipped.has(frame.id));
  return waiting.sort((a, b) => Number(b.id === onScreen) - Number(a.id === onScreen) || a.sequenceIndex - b.sequenceIndex);
}

/**
 * Embeds photos quietly in the background on this device (no upload), so bursts can be split at real scene changes
 * and look-alike frames without capture times can be grouped. A failed picture is skipped; a failed model leaves grouping time-based and says so once.
 */
export function useVisualGrouping({ projectId, frames, provider, active, onScreen, onEmbedded, onBatchDone, onUnavailable }: Options) {
  const latest = useRef({ projectId, frames, provider, active, onScreen, onEmbedded, onBatchDone, onUnavailable });
  latest.current = { projectId, frames, provider, active, onScreen, onEmbedded, onBatchDone, onUnavailable };
  const running = useRef(false);
  useEffect(() => { startNotingInput(); }, []);
  const halted = useRef(false);
  const skipped = useRef(new Set<string>());

  const run = useCallback(async () => {
    if (running.current || halted.current) return;
    const { projectId: currentId, provider: store } = latest.current;
    if (!store) return;
    running.current = true;
    try {
      const outcome = await runEmbeddingPass<PhotoFrame, HTMLCanvasElement, StoredEmbedding>({
        next: () => embeddingCandidates(latest.current.frames, latest.current.onScreen, skipped.current)[0],
        stillCurrent: () => latest.current.active && latest.current.projectId === currentId,
        picture: (frame) => pictureForAnalysis(store, frame),
        embed: embedPicture,
        onEmbedded: (frameId, embedding) => latest.current.onEmbedded(frameId, embedding),
        onBatchDone: () => latest.current.onBatchDone(),
        // The model is missing or failed its check: say so once; grouping stays time-based for this session.
        onUnavailable: (message) => latest.current.onUnavailable?.(message),
        skip: (frameId) => { skipped.current.add(frameId); },
        untilQuiet: () => untilQuiet(QUIET_MS),
        pause: () => new Promise((resolve) => window.setTimeout(resolve, 20)),
        batch: BATCH,
      });
      if (outcome === 'halted') halted.current = true;
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => { skipped.current.clear(); }, [projectId]);
  const waiting = embeddingCandidates(frames, onScreen, skipped.current).length;
  useEffect(() => {
    if (active && provider && waiting > 0 && !running.current) void run();
  }, [active, provider, waiting, run]);
}

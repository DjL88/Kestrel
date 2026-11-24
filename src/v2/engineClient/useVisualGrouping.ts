import { useCallback, useEffect, useRef } from 'react';
import { hasCurrentEmbedding, type StoredEmbedding } from '../../core/visualSimilarity';
import type { PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { pictureForAnalysis } from '../../providers/pictureForAnalysis';
import { embedPicture } from '../../providers/visualEmbedder';

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
}

const BATCH = 12;

/** Photos still to embed: live, not yet embedded with the current model, the photo on screen first. */
export function embeddingCandidates(frames: PhotoFrame[], onScreen: string | null, skipped: ReadonlySet<string>): PhotoFrame[] {
  const waiting = frames.filter((frame) => frame.removedAt == null && !hasCurrentEmbedding(frame.visualEmbedding) && !skipped.has(frame.id));
  return waiting.sort((a, b) => Number(b.id === onScreen) - Number(a.id === onScreen) || a.sequenceIndex - b.sequenceIndex);
}

/**
 * Embeds photos quietly in the background on this device (no upload), so bursts can be split at real scene changes
 * and look-alike frames without capture times can be grouped. A failed model or picture leaves grouping time-based.
 */
export function useVisualGrouping({ projectId, frames, provider, active, onScreen, onEmbedded, onBatchDone }: Options) {
  const latest = useRef({ projectId, frames, provider, active, onScreen, onEmbedded, onBatchDone });
  latest.current = { projectId, frames, provider, active, onScreen, onEmbedded, onBatchDone };
  const running = useRef(false);
  const halted = useRef(false);
  const skipped = useRef(new Set<string>());

  const run = useCallback(async () => {
    if (running.current || halted.current) return;
    running.current = true;
    let sinceBatch = 0;
    try {
      for (;;) {
        const { projectId: currentId, frames: current, provider: store, onScreen: focus } = latest.current;
        const stillCurrent = () => latest.current.active && latest.current.projectId === currentId;
        if (!stillCurrent() || !store) break;
        const frame = embeddingCandidates(current, focus, skipped.current)[0];
        if (!frame) break;
        const picture = await pictureForAnalysis(store, frame).catch(() => null);
        if (!stillCurrent()) break;
        if (!picture) { skipped.current.add(frame.id); continue; }
        let embedding: StoredEmbedding | null = null;
        try {
          embedding = await embedPicture(picture);
        } catch {
          // The model is missing or failed its check: stop for this session, grouping stays time-based.
          halted.current = true;
          break;
        }
        if (!stillCurrent()) break;
        skipped.current.add(frame.id);
        if (embedding) { latest.current.onEmbedded(frame.id, embedding); sinceBatch += 1; }
        if (sinceBatch >= BATCH) { latest.current.onBatchDone(); sinceBatch = 0; }
        // Yield between photos so the interface stays responsive.
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
    } finally {
      if (sinceBatch > 0) latest.current.onBatchDone();
      running.current = false;
    }
  }, []);

  useEffect(() => { skipped.current.clear(); }, [projectId]);
  const waiting = embeddingCandidates(frames, onScreen, skipped.current).length;
  useEffect(() => {
    if (active && provider && waiting > 0 && !running.current) void run();
  }, [active, provider, waiting, run]);
}

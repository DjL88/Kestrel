import { useCallback, useEffect, useRef, useState } from 'react';
import { scanCandidates, scanPatch } from './core/autoTags';
import type { SubjectGrid } from './core/maskTypes';
import { SPECIES_MODEL } from './core/speciesModel';
import { kindFor, personalBonus, pickSuggestions, rankSpecies } from './core/speciesMatch';
import type { PhotoFrame } from './core/types';
import type { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import { pictureForAnalysis } from './providers/pictureForAnalysis';
import { analysePicture, downloadSpeciesModel, loadSpeciesLabels, speciesStatus, type SpeciesStatus } from './providers/speciesModel';
import { readAutoTag, readSpeciesCounts } from './providers/speciesLearning';

/** How long the subject is shown on a card before its name appears. */
export const FLASH_MS = 1100;

interface Options {
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  /** True while the project page is showing. Looking pauses while a photo is being edited. */
  active: boolean;
  onResult: (frameId: string, patch: ReturnType<typeof scanPatch>) => void;
}

/**
 * Works through the photos in a project that nobody has looked at, one at a time, in the background. For each one the
 * subject is shown briefly on its card, then the species is stored if the model is sure. Nothing happens until the
 * species model has been downloaded, and the user can turn automatic tagging off.
 */
export function useSpeciesScan({ frames, provider, active, onResult }: Options) {
  const [status, setStatus] = useState<SpeciesStatus | 'checking'>('checking');
  const [progress, setProgress] = useState({ done: 0, total: 0, running: false });
  const [flash, setFlash] = useState<{ frameId: string; grid: SubjectGrid } | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState('');
  const latest = useRef({ frames, provider, onResult });
  latest.current = { frames, provider, onResult };
  const running = useRef(false);
  const cancelled = useRef(false);
  const skipped = useRef(new Set<string>());
  const done = useRef(0);

  useEffect(() => { void speciesStatus().then(setStatus); }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const { labels, vectors } = await loadSpeciesLabels();
      for (;;) {
        const { frames: current, provider: store, onResult: report } = latest.current;
        if (cancelled.current || !store || !readAutoTag()) break;
        const todo = scanCandidates(current).filter((frame) => !skipped.current.has(frame.id));
        if (!todo.length) break;
        setProgress({ done: done.current, total: done.current + todo.length, running: true });
        const frame = todo[0];
        const picture = await pictureForAnalysis(store, frame).catch(() => null);
        if (!picture) { skipped.current.add(frame.id); continue; } // A file that is not available now is tried again next time.
        const { grid, embedding } = await analysePicture(picture);
        if (cancelled.current) break;
        const best = pickSuggestions(rankSpecies(embedding, labels, vectors, personalBonus(labels, readSpeciesCounts())))[0];
        if (grid) {
          setFlash({ frameId: frame.id, grid });
          await new Promise((resolve) => window.setTimeout(resolve, FLASH_MS));
          if (cancelled.current) break;
        }
        setFlash(null);
        report(frame.id, scanPatch(frame, best ? { name: best.label.common, probability: best.probability, kind: kindFor(best.label) } : undefined));
        done.current += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 30)); // Let the page breathe between photos.
      }
    } catch (reason) {
      console.warn('Looking at the photos stopped', reason);
      setError('Looking at your photos stopped. Open the photo and use Look again to try one by hand.');
    } finally {
      running.current = false;
      setFlash(null);
      setProgress((prior) => ({ ...prior, running: false }));
    }
  }, []);

  const ready = status === 'ready' && active && provider !== null;
  useEffect(() => {
    if (!ready) return;
    cancelled.current = false;
    void run();
    return () => { cancelled.current = true; };
  }, [ready, run]);

  // Photos added while looking, or after, are picked up too.
  const waiting = scanCandidates(frames).length;
  useEffect(() => {
    if (ready && waiting > 0 && !running.current) { cancelled.current = false; void run(); }
  }, [ready, waiting, run]);

  async function download() {
    setDownloading(0);
    setError('');
    try {
      await downloadSpeciesModel(setDownloading);
      done.current = 0;
      setStatus('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The download failed.');
    } finally {
      setDownloading(null);
    }
  }

  return { status, progress, flash, downloading, download, error, size: SPECIES_MODEL.bytes, pending: waiting };
}

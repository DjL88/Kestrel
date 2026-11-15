import { useCallback, useEffect, useRef, useState } from 'react';
import { qualifiesForAutoTag, scanCandidates, scanPatch } from './core/autoTags';
import type { SubjectGrid } from './core/maskTypes';
import { SPECIES_MODEL } from './core/speciesModel';
import { kindFor, personalBonus, pickSuggestions, rankSpecies } from './core/speciesMatch';
import type { PhotoFrame } from './core/types';
import type { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import { pictureForAnalysis } from './providers/pictureForAnalysis';
import { analysePicture, downloadSpeciesModel, loadSpeciesLabels, speciesStatus, type SpeciesStatus } from './providers/speciesModel';
import { readAutoTag, readSpeciesCounts } from './providers/speciesLearning';
import { HELPER_GAP_MS, HELPER_SESSION_CAP, failureMessage, helperPatch, helperReady } from './core/onlineHelper';
import { useHelperSettings } from './providers/helperSettings';
import { HelperError, geminiTransport, imageForHelper } from './providers/onlineHelper';
import { detectSubject } from './providers/subjectDetector';

/** How long the subject is shown on a card before its name appears. */
export const FLASH_MS = 1100;

/** Photos sent to the online helper in this session, across projects. Counted so the cap holds however often it restarts. */
let helperSent = 0;

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return online;
}

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
  const online = useOnline();
  const helper = useHelperSettings();
  const mode: 'device' | 'online' | null = status === 'ready' ? 'device' : helperReady(helper, { online }) ? 'online' : null;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const helperKey = useRef(helper.key);
  helperKey.current = helper.key;
  const halted = useRef(false);
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
        let patch: ReturnType<typeof scanPatch>;
        let grid: SubjectGrid | null = null;
        if (modeRef.current === 'device') {
          const analysed = await analysePicture(picture);
          grid = analysed.grid;
          const top = pickSuggestions(rankSpecies(analysed.embedding, labels, vectors, personalBonus(labels, readSpeciesCounts())))[0];
          // Personal preferences can reorder suggestions but never qualify a name: the model's own ranking must be sure too.
          const best = top && qualifiesForAutoTag(top, analysed.embedding, labels, vectors) ? top : undefined;
          patch = scanPatch(frame, best ? { name: best.label.common, probability: best.probability, kind: kindFor(best.label) } : undefined);
        } else if (modeRef.current === 'online') {
          if (helperSent >= HELPER_SESSION_CAP) { setError(`The online helper has looked at ${HELPER_SESSION_CAP} photos this session, which is its limit. Reload to continue.`); break; }
          try { const found = await detectSubject(picture); if (found.assessment.usable) grid = found.grid; } catch { /* No flash without a mask. */ }
          let answer;
          try {
            answer = await geminiTransport(helperKey.current).ask(imageForHelper(picture));
          } catch (failure) {
            const reason = failure instanceof HelperError ? failure.failure : 'other';
            const { text, stops } = failureMessage(reason);
            if (stops) { halted.current = true; if (text) setError(text); break; }
            skipped.current.add(frame.id); // One photo it could not answer for: move on, and ask again another time.
            continue;
          }
          helperSent += 1;
          patch = helperPatch(frame, answer);
        } else break;
        if (cancelled.current) break;
        if (grid) {
          setFlash({ frameId: frame.id, grid });
          await new Promise((resolve) => window.setTimeout(resolve, FLASH_MS));
          if (cancelled.current) break;
        }
        setFlash(null);
        report(frame.id, patch);
        done.current += 1;
        if (modeRef.current === 'online') await new Promise((resolve) => window.setTimeout(resolve, HELPER_GAP_MS));
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

  const ready = mode !== null && active && provider !== null;
  // A new key, a new connection or a switch change is a fresh start after a halt.
  useEffect(() => { halted.current = false; setError(''); }, [helper.key, helper.enabled, online, status]);
  useEffect(() => {
    if (!ready) return;
    cancelled.current = false;
    void run();
    return () => { cancelled.current = true; };
  }, [ready, mode, run]);

  // Photos added while looking, or after, are picked up too.
  const waiting = scanCandidates(frames).length;
  useEffect(() => {
    if (ready && waiting > 0 && !running.current && !halted.current) { cancelled.current = false; void run(); }
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

  return { status, mode, helperOn: mode === 'online', progress, flash, downloading, download, error, size: SPECIES_MODEL.bytes, pending: waiting };
}

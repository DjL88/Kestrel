import { useCallback, useEffect, useRef, useState } from 'react';
import { qualifiesForAutoTag, scanCandidates, scanPatch } from './core/autoTags';
import { SPECIES_MODEL } from './core/speciesModel';
import { kindFor, personalBonus, pickSuggestions, rankSpecies } from './core/speciesMatch';
import type { PhotoFrame } from './core/types';
import type { BrowserPreviewProvider } from './providers/browserPreviewProvider';
import { pictureForAnalysis } from './providers/pictureForAnalysis';
import { analysePicture, downloadSpeciesModel, loadSpeciesLabels, speciesStatus, type SpeciesStatus } from './providers/speciesModel';
import { readAutoTag, readSpeciesCounts } from './providers/speciesLearning';
import { gateOutcome } from './core/categoryGate';
import { STRICT_SPECIES_PROBABILITY } from './core/subjectRouter';
import { subjectCrop } from './core/subjectCrop';
import { gateAvailable, routePicture } from './providers/categoryGate';
import { HELPER_GAP_MS, HELPER_SESSION_CAP, failureMessage, helperPatch, helperReady } from './core/onlineHelper';
import { ONLINE_HELPER_VISIBLE, useHelperSettings } from './providers/helperSettings';
import { HelperError, geminiTransport, imageForHelper } from './providers/onlineHelper';

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
  projectId: string;
  frames: PhotoFrame[];
  provider: BrowserPreviewProvider | null;
  /** True while the project page is showing. Looking pauses while a photo is being edited. */
  active: boolean;
  onResult: (frameId: string, patch: ReturnType<typeof scanPatch>) => void;
}

/** Identifies untagged photos quietly, using the on-device model first. */
export function useSpeciesScan({ projectId, frames, provider, active, onResult }: Options) {
  const [status, setStatus] = useState<SpeciesStatus | 'checking'>('checking');
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState('');
  const online = useOnline();
  const helper = useHelperSettings();
  const helperOn = helperReady(helper, { online });
  const localReady = status === 'ready';
  const sources = useRef({ localReady, helperOn, key: helper.key });
  sources.current = { localReady, helperOn, key: helper.key };
  const helperHalted = useRef(false);
  const latest = useRef({ projectId, frames, provider, active, onResult });
  latest.current = { projectId, frames, provider, active, onResult };
  const running = useRef(false);
  const cancelled = useRef(false);
  const skipped = useRef(new Set<string>());

  useEffect(() => { void speciesStatus().then(setStatus); }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const localLabels = await loadSpeciesLabels().catch(() => null);
      for (;;) {
        const { projectId: currentId, frames: current, provider: store, onResult: report } = latest.current;
        const stillCurrent = () => !cancelled.current && latest.current.active && latest.current.projectId === currentId;
        const available = sources.current;
        if (!stillCurrent() || !store || !readAutoTag()) break;
        const canAsk = () => sources.current.helperOn && sources.current.key === available.key &&
          !helperHalted.current && helperSent < HELPER_SESSION_CAP;
        if (!available.localReady && !canAsk()) break;
        const frameKey = (id: string) => `${currentId}|${id}`;
        // With the category gate, the local model may look at unclassified photos too: the gate, not the species list,
        // decides whether a photo is an animal at all.
        const gateOn = available.localReady && gateAvailable();
        const frame = scanCandidates(current, { includeUnclassified: canAsk() || gateOn }).find((candidate) => !skipped.current.has(frameKey(candidate.id)));
        if (!frame) break;

        const picture = await pictureForAnalysis(store, frame).catch(() => null);
        if (!stillCurrent()) continue;
        if (!picture) { skipped.current.add(frameKey(frame.id)); continue; }

        let patch: ReturnType<typeof scanPatch> | undefined;
        // A closed-list species model must not even run without independent category evidence.
        // This also avoids wasted per-photo ONNX inference on browser builds without the gate.
        if (available.localReady && localLabels && gateOn) {
          try {
            // analysePicture locates the subject on-device before comparing it with the saved species vectors.
            const { labels, vectors } = localLabels;
            const { embedding, grid } = await analysePicture(picture);
            const top = pickSuggestions(rankSpecies(embedding, labels, vectors, personalBonus(labels, readSpeciesCounts())))[0];
            const best = top && qualifiesForAutoTag(top, embedding, labels, vectors) ? top : undefined;
            const named = best ? { name: best.label.common, probability: best.probability, kind: kindFor(best.label) } : undefined;
            // The gate looks at the same square as the species model. If it fails, nothing is decided for this photo.
            const outcome = gateOutcome(await routePicture(picture, subjectCrop(picture.width, picture.height, grid)), frame.subjectKind);
            const kind = frame.subjectKind ?? outcome.kind;
            if (kind === 'wildlife' && outcome.species !== 'block') {
              const sureEnough = outcome.species === 'allow' || (named && named.probability >= STRICT_SPECIES_PROBABILITY);
              patch = scanPatch({ ...frame, subjectKind: kind }, sureEnough ? named : undefined);
              if (outcome.kind) patch = { ...patch, subjectKind: outcome.kind };
            } else if (kind) {
              // Not an animal the list can name (a helicopter, a car): looked at, and no animal name offered.
              patch = { speciesChecked: true };
            }
            // Unclassified and not clearly an animal: unknown stays unknown, and the opted-in helper may still answer.
          } catch { /* A failed local analysis can still use the opted-in fallback. */ }
        }
        if (!stillCurrent() || !readAutoTag()) continue;

        let asked = false;
        if (!patch?.tags?.length && canAsk()) {
          asked = true;
          helperSent += 1;
          try {
            const answer = await geminiTransport(available.key).ask(imageForHelper(picture));
            if (sources.current.helperOn && sources.current.key === available.key) patch = helperPatch(frame, answer);
          } catch (failure) {
            if (sources.current.key === available.key && failure instanceof HelperError && failureMessage(failure.failure).stops) {
              helperHalted.current = true;
            }
          }
        }
        if (!stillCurrent() || !readAutoTag()) continue;
        skipped.current.add(frameKey(frame.id));
        if (patch) report(frame.id, patch);
        await new Promise((resolve) => window.setTimeout(resolve, asked ? HELPER_GAP_MS : 30));
      }
    } finally {
      running.current = false;
    }
  }, []);

  const ready = status !== 'checking' && (localReady || helperOn) && active && provider !== null;
  useEffect(() => { helperHalted.current = false; }, [helper.key, helper.enabled, online]);
  useEffect(() => {
    if (!ready) return;
    cancelled.current = false;
    void run();
    return () => { cancelled.current = true; };
  }, [ready, localReady, helperOn, helper.key, run]);

  // Photos the scan would look at now; with the helper off, unclassified photos still count, so the banner can offer it.
  const waiting = scanCandidates(frames, { includeUnclassified: helperOn || ONLINE_HELPER_VISIBLE }).length;
  useEffect(() => {
    if (ready && waiting > 0 && !running.current) { cancelled.current = false; void run(); }
  }, [ready, waiting, run]);

  async function download() {
    setDownloading(0);
    setError('');
    try {
      await downloadSpeciesModel(setDownloading);
      setStatus('ready');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The download failed.');
    } finally {
      setDownloading(null);
    }
  }

  return { status, helperOn, downloading, download, error, size: SPECIES_MODEL.bytes, pending: waiting };
}

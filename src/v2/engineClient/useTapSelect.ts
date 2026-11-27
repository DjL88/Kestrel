import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { newId } from '../../core/ids';
import { engineText } from '../../i18n/areas/engine';
import { v2Text } from '../../i18n/areas/v2';
import { createSubjectMask, framingKey, type Mask } from '../../core/maskTypes';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import { samConfidence, samMaskDetail, samMaskToGrid, tapSelectPrompt } from '../../core/tapSelectMask';
import { isWholeSubjectPrompt } from '../../core/efficientSam';
import type { CullingState, PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadExportSource } from '../../providers/browserExport';
import { loadImage } from '../../providers/loadImage';
import { downloadTapSelect, encodePhoto, isPhotoEncoded, selectSubjects, tapSelectStatus } from '../../providers/tapSelect';
import { engineScheduler } from '../../core/engineScheduler';
import type { TapPoint, TapSelectState } from '../ui/contract';
import { canAddMask } from './maskOps';

/** The photo is read at most this size on the long edge; the model itself works at 1024. */
const READ_EDGE = 2048;
/** The photo's identity and framing: one reading per original and crop. */
const keyOf = (frame: PhotoFrame) => `${frame.stableKey}|${frame.originalSha256 ?? ''}|${framingKey(frame.framing ?? DEFAULT_FRAMING)}`;
/** How long a photo stays on screen before it is read ahead for tap to select, so flicking through photos reads none. */
export const PREPARE_AFTER_MS = 1500;
/** While other heavy work runs, look again this often. */
export const PREPARE_RETRY_MS = 5000;

interface Deps {
  stateRef: MutableRefObject<CullingState | null | undefined>;
  provider: MutableRefObject<BrowserPreviewProvider | null | undefined>;
  editFrames: (ids: string[], change: (frame: PhotoFrame) => PhotoEdit | undefined) => void;
  setNotice: (notice: string) => void;
  /** The photo open in the editor, or null. With the pack installed it is read ahead, so a tap answers at once. */
  onScreen?: string | null;
}

/**
 * Tap-to-select on the V2 canvas with the optional EfficientSAM-Ti pack (src/providers/tapSelect.ts). The photo is read
 * once (about half a minute in single-thread WASM), then every tap updates the active subject's own reversible subject
 * mask in a fraction of a second. With the pack installed, the photo open in the editor is read ahead in the background
 * (in a worker, only while no other heavy work runs), so the first tap usually answers at once. Each tap is one undo step. Taps live only for this session; the saved recipe holds
 * the resulting outline, so reopening needs no model.
 */
export function useTapSelect({ stateRef, provider, editFrames, setNotice, onScreen = null }: Deps) {
  const [state, setState] = useState<TapSelectState>({ pack: 'unavailable' });
  const live = useRef<{ key: string; size: { w: number; h: number }; framing: string; framed: HTMLCanvasElement } | null>(null);
  const sessionRef = useRef<TapSelectState['session']>(undefined);
  sessionRef.current = state.session;

  useEffect(() => {
    let cancelled = false;
    tapSelectStatus().then(pack => { if (!cancelled) setState(current => current.pack === 'downloading' ? current : { ...current, pack }); })
      .catch(() => { if (!cancelled) setState(current => ({ ...current, pack: 'unavailable' })); });
    return () => { cancelled = true; };
  }, []);

  const download = useCallback(() => {
    setState(current => ({ ...current, pack: 'downloading', downloadProgress: 0, message: undefined }));
    downloadTapSelect((fraction) => setState(current => ({ ...current, downloadProgress: fraction })))
      .then(() => setState(current => ({ ...current, pack: 'ready', downloadProgress: 1 })))
      .catch((error: unknown) => setState(current => ({ ...current, pack: 'failed',
        message: error instanceof Error ? error.message : 'The tap-to-select download did not finish. Nothing was changed.' })));
  }, []);

  /** Read one photo for tap to select (or join a reading already running for it). The same path for a tap and a read-ahead. */
  /** The stored screen develop, else the picture shown now; null when there is neither. */
  const screenSizePicture = useCallback(async (frame: PhotoFrame): Promise<HTMLImageElement | null> => {
    const source = provider.current!;
    const review = (await source.developedReview(frame).catch(() => null))?.review;
    if (review) {
      const url = URL.createObjectURL(review);
      try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
    }
    const shown = await source.getFullPreviewUrl(frame, 'selected').catch(() => '');
    return shown ? loadImage(shown).catch(() => null) : null;
  }, [provider]);

  const readPhoto = useCallback(async (frame: PhotoFrame) => {
    const framing = frame.framing ?? DEFAULT_FRAMING;
    const key = keyOf(frame);
    // A mask needs the photo's shape and content at READ_EDGE (2,048 px), not export-grade pixels. For a RAW or HEIF the
    // stored 2,200 px screen develop, or else the picture already shown, is enough: a full 45 MP develop took most of the
    // "Reading the photo once" wait. Only when neither exists is the full source developed.
    const image = isRawPreviewFile(frame.filename) || isHeifFile(frame.filename)
      ? await screenSizePicture(frame) ?? await loadExportSource(frame, provider.current!)
      : await loadExportSource(frame, provider.current!);
    const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
    const framed = document.createElement('canvas');
    drawFramedPhoto(image, framed, framing, { scale: Math.min(1, READ_EDGE / Math.max(width, height)) });
    return { key, size: await encodePhoto(framed, key), framing: framingKey(framing), framed };
  }, [provider, screenSizePicture]);

  // Read ahead: the photo open in the editor, once it has stayed there a moment and no other heavy work is running.
  // Not a scheduler job on purpose: with free memory unknown the scheduler runs one heavy job at a time and cannot stop
  // one midway, so a half-minute reading would hold up "Find subject" or an export. The reading runs in a worker, so it
  // never blocks the interface; it only shares the processor, and it waits while the scheduler is busy.
  useEffect(() => {
    if (state.pack !== 'ready' || !onScreen || state.session) return;
    let stopped = false;
    let timer = 0;
    const attempt = () => {
      if (stopped) return;
      const frame = stateRef.current?.frames.find(candidate => candidate.id === onScreen && !candidate.removedAt);
      if (!frame || !provider.current || isPhotoEncoded(keyOf(frame))) return;
      const busy = engineScheduler.runningResourceCount();
      if (busy.cpu + busy.gpu > 0) { timer = window.setTimeout(attempt, PREPARE_RETRY_MS); return; }
      void readPhoto(frame).catch(() => undefined); // a failure here is retried when the person taps, with its own message
    };
    timer = window.setTimeout(attempt, PREPARE_AFTER_MS);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [state.pack, state.session, onScreen, stateRef, provider, readPhoto]);

  const start = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find(candidate => candidate.id === photoId && !candidate.removedAt);
    if (!frame || !provider.current) return;
    // Already read ahead: ready at once. Otherwise this joins the reading if one is running.
    const ready = isPhotoEncoded(keyOf(frame));
    setState(current => ({ ...current, message: undefined, session: { photoId, phase: ready ? 'ready' : 'reading', mode: 'add', subjects: [], active: 0 } }));
    void (async () => {
      const { key, size, framing, framed } = await readPhoto(frame);
      live.current = { key, size, framing, framed };
      setState(current => current.session?.photoId === photoId ? { ...current, session: { ...current.session, phase: 'ready' } } : current);
    })().catch((error: unknown) => {
      live.current = null;
      setState(current => current.session?.photoId === photoId ? { ...current,
        message: error instanceof Error ? error.message : 'Tap to select could not read this photo. Nothing was changed.',
        session: { ...current.session, phase: 'failed' } } : current);
    });
  }, [stateRef, provider, readPhoto]);

  const tap = useCallback((photoId: string, point: TapPoint) => {
    const session = sessionRef.current;
    const reading = live.current;
    if (!session || session.photoId !== photoId || !reading || (session.phase !== 'ready' && session.phase !== 'working')) return;
    const add = point.add && session.mode === 'add';
    const existing = session.subjects[session.active];
    // A new subject begins with a tap that adds; a remove tap needs something to remove from.
    if (!existing && !add) return;
    const frame = stateRef.current?.frames.find(candidate => candidate.id === photoId);
    if (!existing && !canAddMask(frame?.edit?.masks)) { setNotice(engineText.workspace.masksFull); return; }
    const subject = existing ?? { maskId: newId(), taps: [] };
    const taps = [...subject.taps, { x: point.x, y: point.y, add }];
    const subjects = [...session.subjects];
    subjects[session.active] = { ...subject, taps };
    setState(current => ({ ...current, session: { ...session, subjects, phase: 'working' } }));
    const prompt = tapSelectPrompt(taps, reading.size);
    void selectSubjects(reading.key, [prompt]).then(([result]) => {
      setState(current => current.session ? { ...current, session: { ...current.session, phase: 'ready' } } : current);
      if (!result || result.coverage === 0) { setNotice(engineText.workspace.tapNothingSelected); return; }
      const grid = samMaskToGrid(result);
      const detail = samMaskDetail(result);
      const confidence = samConfidence(result.score);
      const mask: Mask = { ...createSubjectMask(subject.maskId, grid, reading.framing, confidence, detail), feather: 0.3 };
      saveOutline(photoId, reading.framing, mask);
      // A first tap selects the whole subject: with the fine-edge pack (desktop), its finer edge replaces the outline,
      // only when both models found the same subject, and only while no later tap has changed this subject.
      if (!isWholeSubjectPrompt(prompt)) return;
      // In a background worker (src/providers/fineEdgeMask.ts), so the photo can be worked on while it runs; the panel
      // says so meanwhile. Skipped, in plain words, when there is not enough free memory for it.
      const setRefining = (refining: boolean) => setState(current => current.session?.photoId === photoId
        ? { ...current, session: { ...current.session, refining } } : current);
      void import('../../providers/fineEdgeMask').then(async (m) => {
        if (await m.fineEdgeStatus() !== 'ready') return;
        setRefining(true);
        try {
          const refined = await m.refineSubjectGrid(reading.framed, grid, detail).catch((problem: unknown) => {
            if (problem instanceof m.FineEdgeSkipped) setNotice(v2Text.tapSelect.refineSkipped);
            return null;
          });
          if (!refined) return;
          const now = sessionRef.current?.subjects.find(item => item.maskId === subject.maskId);
          if (!now || now.taps.length !== 1) return;
          saveOutline(photoId, reading.framing, { ...createSubjectMask(subject.maskId, refined.grid, reading.framing, confidence, refined.detail), feather: 0.3 });
        } finally {
          setRefining(false);
        }
      }).catch(() => undefined);
    }).catch((error: unknown) => {
      setState(current => current.session ? { ...current, session: { ...current.session, phase: 'ready' } } : current);
      setNotice(error instanceof Error ? error.message : engineText.workspace.tapNotAnswered);
    });
  }, [stateRef, editFrames, setNotice]);

  /** Put one subject's outline on its mask layer, keeping the person's own adjustments and switches on that layer. */
  const saveOutline = useCallback((photoId: string, framing: string, mask: Mask) => {
      editFrames([photoId], (latest) => {
        if (framingKey(latest.framing ?? DEFAULT_FRAMING) !== framing) return latest.edit;
        const masks = latest.edit?.masks ?? [];
        const kept = masks.find(item => item.id === mask.id);
        // Keep the person's own adjustments and switches on an existing layer; only its outline changes.
        const next = kept ? { ...mask, edit: kept.edit, invert: kept.invert, hidden: kept.hidden, limit: kept.limit, feather: kept.feather } as Mask : mask;
        if (!kept && !canAddMask(masks)) return latest.edit;
        return { ...(latest.edit ?? DEFAULT_EDIT), masks: kept ? masks.map(item => item.id === mask.id ? next : item) : [...masks, next] };
      });
  }, [editFrames]);

  const setMode = useCallback((mode: 'add' | 'remove') => setState(current => current.session ? { ...current, session: { ...current.session, mode } } : current), []);
  const newSubject = useCallback(() => setState(current => current.session
    ? { ...current, session: { ...current.session, mode: 'add', active: current.session.subjects.length } } : current), []);
  const finish = useCallback(() => setState(current => ({ ...current, session: undefined })), []);

  const actions = useMemo(() => ({ downloadTapSelect: download, startTapSelect: start, tapSelectAt: tap, setTapSelectMode: setMode, newTapSubject: newSubject, finishTapSelect: finish }),
    [download, start, tap, setMode, newSubject, finish]);
  return { state, actions };
}

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { newId } from '../../core/ids';
import { engineText } from '../../i18n/areas/engine';
import { createSubjectMask, framingKey, type Mask } from '../../core/maskTypes';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import { samConfidence, samMaskToGrid, tapSelectPrompt } from '../../core/tapSelectMask';
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
  const live = useRef<{ key: string; size: { w: number; h: number }; framing: string } | null>(null);
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
  const readPhoto = useCallback(async (frame: PhotoFrame) => {
    const framing = frame.framing ?? DEFAULT_FRAMING;
    const key = keyOf(frame);
    // A mask needs the photo's shape and content, not export-grade pixels: fall back to the shown preview for RAW/HEIF.
    const image = await loadExportSource(frame, provider.current!).catch(async (reason) => {
      const shown = isRawPreviewFile(frame.filename) || isHeifFile(frame.filename)
        ? await provider.current!.getFullPreviewUrl(frame, 'selected').catch(() => '') : '';
      if (!shown) throw reason;
      return loadImage(shown);
    });
    const { width, height } = framedSize(image.naturalWidth, image.naturalHeight, framing);
    const framed = document.createElement('canvas');
    drawFramedPhoto(image, framed, framing, { scale: Math.min(1, READ_EDGE / Math.max(width, height)) });
    return { key, size: await encodePhoto(framed, key), framing: framingKey(framing) };
  }, [provider]);

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
      const { key, size, framing } = await readPhoto(frame);
      live.current = { key, size, framing };
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
    void selectSubjects(reading.key, [tapSelectPrompt(taps, reading.size)]).then(([result]) => {
      setState(current => current.session ? { ...current, session: { ...current.session, phase: 'ready' } } : current);
      if (!result || result.coverage === 0) { setNotice(engineText.workspace.tapNothingSelected); return; }
      const mask: Mask = {
        ...createSubjectMask(subject.maskId, samMaskToGrid(result), reading.framing, samConfidence(result.score)),
        feather: 0.3,
      };
      editFrames([photoId], (latest) => {
        if (framingKey(latest.framing ?? DEFAULT_FRAMING) !== reading.framing) return latest.edit;
        const masks = latest.edit?.masks ?? [];
        const kept = masks.find(item => item.id === mask.id);
        // Keep the person's own adjustments and switches on an existing layer; only its outline changes.
        const next = kept ? { ...mask, edit: kept.edit, invert: kept.invert, hidden: kept.hidden, limit: kept.limit, feather: kept.feather } as Mask : mask;
        if (!kept && !canAddMask(masks)) return latest.edit;
        return { ...(latest.edit ?? DEFAULT_EDIT), masks: kept ? masks.map(item => item.id === mask.id ? next : item) : [...masks, next] };
      });
    }).catch((error: unknown) => {
      setState(current => current.session ? { ...current, session: { ...current.session, phase: 'ready' } } : current);
      setNotice(error instanceof Error ? error.message : engineText.workspace.tapNotAnswered);
    });
  }, [stateRef, editFrames, setNotice]);

  const setMode = useCallback((mode: 'add' | 'remove') => setState(current => current.session ? { ...current, session: { ...current.session, mode } } : current), []);
  const newSubject = useCallback(() => setState(current => current.session
    ? { ...current, session: { ...current.session, mode: 'add', active: current.session.subjects.length } } : current), []);
  const finish = useCallback(() => setState(current => ({ ...current, session: undefined })), []);

  const actions = useMemo(() => ({ downloadTapSelect: download, startTapSelect: start, tapSelectAt: tap, setTapSelectMode: setMode, newTapSubject: newSubject, finishTapSelect: finish }),
    [download, start, tap, setMode, newSubject, finish]);
  return { state, actions };
}

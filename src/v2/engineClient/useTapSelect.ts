import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { newId } from '../../core/ids';
import { createSubjectMask, framingKey, type Mask } from '../../core/maskTypes';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { isHeifFile, isRawPreviewFile } from '../../core/rawFormats';
import { samConfidence, samMaskToGrid, tapSelectPrompt } from '../../core/tapSelectMask';
import type { CullingState, PhotoFrame } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { loadExportSource } from '../../providers/browserExport';
import { loadImage } from '../../providers/loadImage';
import { downloadTapSelect, encodePhoto, selectSubjects, tapSelectStatus } from '../../providers/tapSelect';
import type { TapPoint, TapSelectState } from '../ui/contract';
import { canAddMask } from './maskOps';

/** The photo is read at most this size on the long edge; the model itself works at 1024. */
const READ_EDGE = 2048;

interface Deps {
  stateRef: MutableRefObject<CullingState | null | undefined>;
  provider: MutableRefObject<BrowserPreviewProvider | null | undefined>;
  editFrames: (ids: string[], change: (frame: PhotoFrame) => PhotoEdit | undefined) => void;
  setNotice: (notice: string) => void;
}

/**
 * Tap-to-select on the V2 canvas with the optional EfficientSAM-Ti pack (src/providers/tapSelect.ts). The photo is read
 * once (about half a minute in single-thread WASM), then every tap updates the active subject's own reversible subject
 * mask in a fraction of a second. Each tap is one undo step. Taps live only for this session; the saved recipe holds
 * the resulting outline, so reopening needs no model.
 */
export function useTapSelect({ stateRef, provider, editFrames, setNotice }: Deps) {
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

  const start = useCallback((photoId: string) => {
    const frame = stateRef.current?.frames.find(candidate => candidate.id === photoId && !candidate.removedAt);
    if (!frame || !provider.current) return;
    const framing = frame.framing ?? DEFAULT_FRAMING;
    const key = `${frame.stableKey}|${frame.originalSha256 ?? ''}|${framingKey(framing)}`;
    setState(current => ({ ...current, message: undefined, session: { photoId, phase: 'reading', mode: 'add', subjects: [], active: 0 } }));
    void (async () => {
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
      const size = await encodePhoto(framed, key);
      live.current = { key, size, framing: framingKey(framing) };
      setState(current => current.session?.photoId === photoId ? { ...current, session: { ...current.session, phase: 'ready' } } : current);
    })().catch((error: unknown) => {
      live.current = null;
      setState(current => current.session?.photoId === photoId ? { ...current,
        message: error instanceof Error ? error.message : 'Tap to select could not read this photo. Nothing was changed.',
        session: { ...current.session, phase: 'failed' } } : current);
    });
  }, [stateRef, provider]);

  const tap = useCallback((photoId: string, point: TapPoint) => {
    const session = sessionRef.current;
    const reading = live.current;
    if (!session || session.photoId !== photoId || !reading || (session.phase !== 'ready' && session.phase !== 'working')) return;
    const add = point.add && session.mode === 'add';
    const existing = session.subjects[session.active];
    // A new subject begins with a tap that adds; a remove tap needs something to remove from.
    if (!existing && !add) return;
    const frame = stateRef.current?.frames.find(candidate => candidate.id === photoId);
    if (!existing && !canAddMask(frame?.edit?.masks)) { setNotice('This photo has the most masks it can hold. Remove one first.'); return; }
    const subject = existing ?? { maskId: newId(), taps: [] };
    const taps = [...subject.taps, { x: point.x, y: point.y, add }];
    const subjects = [...session.subjects];
    subjects[session.active] = { ...subject, taps };
    setState(current => ({ ...current, session: { ...session, subjects, phase: 'working' } }));
    void selectSubjects(reading.key, [tapSelectPrompt(taps, reading.size)]).then(([result]) => {
      setState(current => current.session ? { ...current, session: { ...current.session, phase: 'ready' } } : current);
      if (!result || result.coverage === 0) { setNotice('Nothing was selected at that point. Tap inside the subject.'); return; }
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
      setNotice(error instanceof Error ? error.message : 'That tap could not be answered. Nothing was changed.');
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

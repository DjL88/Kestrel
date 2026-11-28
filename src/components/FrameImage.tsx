import { guideEdgeFor, maskCoverageGuide, type MaskGuideStyle } from '../core/maskCoverageGuide';
import type { Mask } from '../core/maskTypes';
import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { preloadTrueDetailAi } from '../core/trueDetailAiCanvas';
import { frameLayers, visibleLayers } from '../core/layers';
import { applyFrameLayers } from '../core/layerAssetVault';
import { frameImageIdentity, framePreviewEncoding, visibleFrameUrl } from '../core/frameImageIdentity';
import { DEFAULT_EDIT, isNeutralEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize, lensCentre } from '../core/photoFraming';
import { fullContext, lumaFromRgba8 } from '../core/masks';
import { loadImage } from '../providers/loadImage';
import { loadExportSource } from '../providers/browserExport';
import { storedEditSource } from '../providers/editSource';
import { raw16Key, raw16Possible, raw16SharpEnough, raw16WorkingFor, raw16Workings } from '../providers/raw16Working';
import { renderRaw16Screen } from '../providers/raw16Render';
import { measureStep, timedStep, timedWait } from '../providers/previewTiming';
import { editGestureActive, onEditGestureEnd } from '../providers/editGesture';
import { liveDraft, liveDraftSupported } from '../providers/liveDraft';
import { recordWorkerVerdict, renderSignature, samePixels, workerVerdict } from '../providers/workerRenderCheck';
import { renderEditOnGpu } from '../providers/webglEdit';
import { useDetailRegion, type DetailSource } from './useDetailRegion';
import { canDevelopRaw } from '../providers/rawDevelop';
import { liveStageCache } from '../providers/liveStageCache';
import React, { useEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle } from './icons/KestrelUIIcons';
import type { PhotoFrame } from '../core/types';
import type { PhotoPreviewReadiness } from '../core/photoTileReadiness';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { viewerText as t } from '../i18n/areas/viewer';
import { isHeifFile } from '../core/rawFormats';

interface FrameImageProps {
  frame: PhotoFrame;
  previewProvider: BrowserPreviewProvider;
  variant: 'thumb' | 'full';
  className?: string;
  imgClassName?: string;
  alt?: string;
  needsAccess?: boolean;
  /** Selected photos outrank queued thumbnails even when their source is not cached. */
  priority?: boolean;
  /** Opt a full-size viewer into the background-developed review picture. */
  refreshOnBackgroundDevelop?: boolean;
  /** Reports actual image readiness; never inferred from the catalogue row existing. */
  onPreviewStatus?: (frameId: string, status: PhotoPreviewReadiness) => void;
  /** Optional editor-only mask coverage, drawn over exactly the displayed image. */
  maskGuideId?: string;
  /** How the guide shows the mask: a line round it, or the hatched area (the default here). */
  maskGuideStyle?: MaskGuideStyle;
  /** The canvas zoom, so the guide is redrawn at the size it is shown (see guideEdgeFor). */
  guideZoom?: number;
  /** Optional editor-only SVG content drawn in the displayed picture's own pixels (mask outline and handles). */
  maskOutline?: (picture: { width: number; height: number }) => React.ReactNode;
  /** Optional interactive transform for zoom/pan viewports */
  zoomScale?: number;
  panOffset?: { x: number; y: number };
  /** V2 editor: when the picture is InFlight's own RAW develop, draw it from the 16-bit develop with the 16-bit edit maths. */
  sensor16?: boolean;
  /** The shown picture's pixel size, each time one loads (the interim one included): its shape for format geometry. */
  onPictureSize?: (size: { width: number; height: number }) => void;
  /** V2 editor: this picture follows the person's edits, so its framed picture is kept ready in the drag worker. */
  prepareDrag?: boolean;
  /** V2 editor: true while the zoomed-in part of the photo is being drawn from its full-resolution picture. */
  onDetailLoading?: (loading: boolean) => void;
  /** True while the picture is loading or being redrawn (the interim thumbnail counts as still loading), false once the
   * full picture is shown or it cannot be shown (a low-quality fallback or a placeholder is not "loading"). */
  onBusyChange?: (busy: boolean) => void;
}

/** The full-size edited view is drawn at most this many pixels on its long edge. */
const FULL_EDGE = 2200;
/** A drag's quick picture is drawn at the size it is shown, never smaller than this. */
const DRAFT_MIN_EDGE = 480;
/** The worker's check of a new kind of edit is made on a copy at most this size (see verifyWorker). */
const VERIFY_EDGE = 320;

/** Developer switch: draw the full-quality picture on the page, as before, to compare it with the worker's. */
const PAGE_RENDER_KEY = 'inflight.debug.page-render';
function pageRenderChosen(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(PAGE_RENDER_KEY) === '1'; } catch { return false; }
}

/**
 * Developer switch, off by default: let the drag worker draw the full-quality picture too, for a kind of edit it has
 * drawn byte for byte as the page did (verifyWorker). Off because that check, on a small copy, did not hold on every
 * machine: on CI the worker's full-size picture differed from the page's (27 Nov), and quality must never differ. So the
 * worker draws only the quick picture while a slider is held, and the full-quality picture is always drawn on the page.
 */
const WORKER_FINAL_KEY = 'inflight.debug.worker-final';
function workerFinalChosen(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(WORKER_FINAL_KEY) === '1'; } catch { return false; }
}

/** The 16-bit pass waits until the slider has been still this long. */
const SENSOR16_SETTLE_MS = 300;

/** A picture that will not load is asked for again this many times, after these waits, before the view settles for less. */
const RETRY_WAITS_MS = [150, 900, 2500];

/** The picture an edit is drawn from: the full source, else the full preview as shown, else the small thumbnail. A
 * view never stays unedited or blank because the original (or a RAW develop) is not available on this device. */
async function loadEditSource(frame: PhotoFrame, provider: BrowserPreviewProvider, variant: 'thumb' | 'full', priority: boolean): Promise<HTMLImageElement> {
  if (variant === 'thumb') return loadThumbSource(frame, provider, priority);
  // The edited view is drawn at most 2,200 px, so a RAW's stored screen develop does when it gives that full size: no
  // 45 MP develop (about 25 s per Nikon Z 8 photo on desktop) just to shrink it again. Zooming past Fit (Canvas) or
  // Develop full size makes the full develop, and from then on that is used.
  const screen = await storedEditSource(frame, provider).catch(() => null);
  if (screen) return screen;
  try {
    return await loadExportSource(frame, provider, 'selected');
  } catch {
    try {
      const url = await provider.getFullPreviewUrl(frame, 'selected');
      if (url) return await loadImage(url);
    } catch { /* fall through to the thumbnail */ }
    return loadThumbSource(frame, provider, true);
  }
}

// Each full-size picture on screen (Before and After are two) has its own place in the 16-bit drawing queue.
let nextSlot = 0;

// Decoded thumbnail pictures, kept so redrawing an edited filmstrip card does not decode the file again.
const thumbSources = new Map<string, Promise<HTMLImageElement>>();
function loadThumbSource(frame: PhotoFrame, provider: BrowserPreviewProvider, priority: boolean): Promise<HTMLImageElement> {
  const key = frame.stableKey;
  let cached = thumbSources.get(key);
  if (cached && priority) provider.prioritizeOriginalRead(key);
  if (!cached) {
    cached = (async () => {
      const url = await provider.getThumbnailUrl(frame, priority ? 'selected' : 'visible');
      if (!url) throw new Error(`No thumbnail for ${frame.filename}`);
      return loadImage(url);
    })();
    cached.catch(() => thumbSources.delete(key));
    thumbSources.set(key, cached);
    // Keep the cache small. The oldest entries go first.
    if (thumbSources.size > 300) thumbSources.delete(thumbSources.keys().next().value as string);
  }
  return cached;
}

/** True when a draft has the same shape as the picture on screen (within 2%), or when no picture size is known yet. */
export function sameShape(draft: { width: number; height: number }, shown: { width: number; height: number } | null): boolean {
  if (!shown || !(shown.width > 0 && shown.height > 0) || !(draft.width > 0 && draft.height > 0)) return true;
  return Math.abs(draft.width / draft.height / (shown.width / shown.height) - 1) <= 0.02;
}

export const FrameImage: React.FC<FrameImageProps> = ({
  frame,
  previewProvider,
  variant,
  className = '',
  imgClassName = '',
  alt,
  needsAccess = false,
  priority = false,
  refreshOnBackgroundDevelop = false,
  onPreviewStatus,
  maskGuideId,
  maskGuideStyle = 'fill',
  guideZoom,
  maskOutline,
  zoomScale = 1,
  panOffset = { x: 0, y: 0 },
  sensor16 = false,
  onPictureSize,
  onBusyChange,
  prepareDrag = false,
  onDetailLoading,
}) => {
  // Keep a finished render for same-frame slider updates, never for a different photo.
  const [sourceRevision, setSourceRevision] = useState(0);
  const identity = frameImageIdentity(frame, variant, sourceRevision);
  // `interim`: the small filmstrip picture shown in the full-size view until the full picture is ready (never reported as ready).
  // `precision`: 'rgb16' when the picture was drawn from the 16-bit RAW develop (one rounding to the screen).
  const [preview, setPreview] = useState<{ identity: string; url: string; interim?: boolean; precision?: 'rgb16' }>({ identity: '', url: '' });
  const src = visibleFrameUrl(preview, identity);
  const [imageSize, setImageSize] = useState<{ src: string; width: number; height: number; fit: 'cover' | 'contain' } | null>(null);
  const imageSizeRef = useRef(imageSize);
  imageSizeRef.current = imageSize;
  const [loading, setLoading] = useState<boolean>(true);
  const [errored, setErrored] = useState<boolean>(false);
  // A picture that failed to load is asked for again (`retries`), showing the small picture with a spinner meanwhile.
  // When every retry fails, the view keeps the small picture, marked as such (`degraded`), or a tidy placeholder.
  const retries = useRef(0);
  const [degraded, setDegraded] = useState(false);
  useEffect(() => { retries.current = 0; setDegraded(false); }, [frame.id, frame.stableKey]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // A virtualised grid still mounts buffer rows. Do not start their disk reads
  // until their cards approach the viewport; selected photos always load now.
  const [nearViewport, setNearViewport] = useState(variant === 'full' || priority);
  useEffect(() => {
    if (variant === 'full' || priority) {
      setNearViewport(true);
      return;
    }
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame.id, variant, priority]);

  // When the background develop finishes this photo, the card swaps the camera's JPEG for InFlight's develop.
  const [developedRev, setDevelopedRev] = useState(0);
  useEffect(() => {
    const key = frame.stableKey;
    const onInvalidate = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== key) return;
      thumbSources.delete(key);
      setSourceRevision((revision) => revision + 1);
    };
    // A full preview released from the provider's cache is revoked: a view showing that address must ask again. A view
    // showing its own edited render keeps it.
    const onReleased = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== key || renderedUrl.current) return;
      setSourceRevision((revision) => revision + 1);
    };
    previewProvider.events.addEventListener('preview-invalidated', onInvalidate);
    previewProvider.events.addEventListener('full-preview-released', onReleased);
    return () => {
      previewProvider.events.removeEventListener('preview-invalidated', onInvalidate);
      previewProvider.events.removeEventListener('full-preview-released', onReleased);
    };
  }, [frame.stableKey, previewProvider]);
  useEffect(() => {
    if (variant !== 'thumb' && !refreshOnBackgroundDevelop) return;
    const key = frame.stableKey;
    const onDeveloped = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== key) return;
      thumbSources.delete(key);
      setDevelopedRev((count) => count + 1);
    };
    previewProvider.events.addEventListener('developed', onDeveloped);
    return () => previewProvider.events.removeEventListener('developed', onDeveloped);
  }, [frame.stableKey, previewProvider, variant, refreshOnBackgroundDevelop]);

  // The 16-bit working copy is made once per photo, only for a photo the person stays on (browsing past photos never
  // starts a full RAW develop for each), and the picture is redrawn from it when it is ready.
  const [raw16Rev, setRaw16Rev] = useState(0);
  const slot = useRef(`picture-${(nextSlot += 1)}`);
  const want16 = sensor16 && variant === 'full' && !frame.isDemo;
  useEffect(() => {
    if (!want16 || raw16Workings.ready(raw16Key(frame))) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const url = await previewProvider.getFullPreviewUrl(frame, 'selected');
        if (cancelled || !url || !raw16Possible(frame, previewProvider.pictureSourceOf(url), canDevelopRaw())) return;
        const working = await raw16WorkingFor(frame, () => previewProvider.ensureOriginal(frame.stableKey, 'selected'), await loadImage(url));
        if (!cancelled && working) setRaw16Rev((count) => count + 1);
      })().catch(() => undefined);
    }, 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want16, frame.stableKey, frame.originalSha256, previewProvider, developedRev, sourceRevision]);

  // Image layers are part of the picture (V2): a change to them redraws it, a change to text or watermark does not.
  const layersKey = JSON.stringify(visibleLayers(frameLayers(frame.overlay)));
  const edited = Boolean((frame.edit && !isNeutralEdit(frame.edit)) || layersKey !== '[]' || (frame.framing &&
    (frame.framing.ratio || frame.framing.turns || frame.framing.straighten)));

  const hasImage = useRef(false);
  // While an edit is redrawn, the new picture is drawn straight onto this canvas over the shown one, so a slider step
  // appears as soon as it is rendered instead of after a PNG encode and decode (about 150 ms at 2,200 px). During a drag
  // only this canvas changes; once the hand is still, one PNG follows and replaces it, so everything that reads the
  // picture's address works as before.
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const [liveFor, setLiveFor] = useState<string | null>(null);
  const previewIsInterim = useRef(false);
  previewIsInterim.current = Boolean(src && preview.interim);
  // An interim thumbnail does not count: an edit redraw must still be able to replace it with a full render.
  hasImage.current = Boolean(src) && !preview.interim;
  const renderedUrl = useRef<string | undefined>(undefined);
  // When a rendered picture's address was handed to the image, so its decode can be measured on load.
  const shownAt = useRef<number | null>(null);
  // The last rendered picture is only released once a newer one replaces it, or on unmount, so it never goes blank mid-edit.
  const replaceRendered = (next: string | undefined) => {
    const previous = renderedUrl.current;
    renderedUrl.current = next;
    if (previous && previous !== next) window.setTimeout(() => URL.revokeObjectURL(previous), 1000);
  };
  useEffect(() => () => replaceRendered(undefined), []);

  // The drag worker holds this picture's framed source under this key; any change to what it shows makes a new one.
  const draftKey = JSON.stringify([identity, frame.originalSha256 ?? null, frame.framing ?? null, developedRev]);
  // The full-resolution picture the last full render came from, for drawing the zoomed-in part again at full detail.
  const detailSource = useRef<DetailSource | null>(null);
  const [renderedRevision, setRenderedRevision] = useState(0);
  /** Draft keys whose worker base came from a full render here (the exact framed pixels), not from the shown file. */
  const baseFromRender = useRef(new Set<string>());
  const zoomRef = useRef(zoomScale);
  zoomRef.current = zoomScale;
  // A quick drag picture was asked for: when the drag ends, the full-quality picture is drawn (settleRev).
  const draftShown = useRef(false);
  const [settleRev, setSettleRev] = useState(0);
  useEffect(() => onEditGestureEnd(() => {
    if (!draftShown.current) return;
    draftShown.current = false;
    setSettleRev((count) => count + 1);
  }), []);
  useEffect(() => () => { if (liveDraftSupported()) liveDraft().release(slot.current); }, []);

  useEffect(() => {
    if (variant === 'thumb' && !nearViewport && !priority) return;
    // A filmstrip card keeps its picture while a slider is held and follows once the drag ends, so the interface thread
    // is free for the picture being edited.
    if (variant === 'thumb' && hasImage.current && editGestureActive()) { draftShown.current = true; return; }
    let cancelled = false;
    let timer: number | undefined;
    // Keep showing the current picture (an interim thumbnail included) while an edited one is being redrawn.
    if (!hasImage.current && !previewIsInterim.current) {
      setPreview({ identity, url: '' });
    }
    // Keep the previous render visible, but report quality work so the
    // refresh indicator stays live during every edit, not only initial load.
    setLoading(true);
    setErrored(false);

    // While a slider is held, each step is a quick picture at the size it is shown, drawn in a worker where it can be, and
    // nothing is encoded. The full-quality picture is drawn once the drag ends (onEditGestureEnd below), exactly as it is
    // drawn without a drag, so dragging never changes what the photo looks like when the hand is still or what exports.
    const dragging = variant === 'full' && hasImage.current && editGestureActive();
    // Marked now, not when the quick picture arrives: the hand may let go before it does, and the full picture must follow.
    if (dragging) draftShown.current = true;

    /** The long edge, in device pixels, the picture is shown at now (zoom included), at most the full 2,200. */
    const shownEdge = (): number => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box || box.width < 1 || box.height < 1) return FULL_EDGE;
      return Math.max(DRAFT_MIN_EDGE, Math.min(FULL_EDGE, Math.ceil(Math.max(box.width, box.height) * (window.devicePixelRatio || 1) * Math.max(1, zoomRef.current))));
    };

    const renderDraft = async (): Promise<boolean> => {
      // Image layers and a stored AI result are drawn on the page, so a picture that has them keeps the page's own draft.
      if (!liveDraftSupported() || layersKey !== '[]' || frame.edit?.trueDetailAi) return false;
      const draft = liveDraft();
      if (draft.baseKey(slot.current) !== draftKey) return false;
      const start = performance.now();
      const edge = shownEdge();
      const bitmap = await draft.draw(slot.current, draftKey, edge, frame.edit ?? DEFAULT_EDIT);
      if (cancelled) { bitmap?.close(); return true; }
      if (!bitmap) return false;
      measureStep('preview:draft', start, { edge });
      // A draft whose shape differs from the picture on screen would be stretched to fit it (Dave, 28 Nov: Luminance
      // slider). Never show it: the full render, drawn from the shown picture, takes its place.
      if (!sameShape(bitmap, imageSizeRef.current)) { bitmap.close(); return false; }
      showLiveBitmap(bitmap);
      return true;
    };

    /**
     * Only with the developer switch (WORKER_FINAL_KEY, off by default): the full-quality picture drawn in the drag worker
     * from the same framed 2,200 px picture it already holds. Null when it is off or cannot (no worker, layers or a stored
     * AI result drawn on the page, no framed picture there yet): then it is drawn here.
     */
    const workerCanDrawFinal = () => variant === 'full' && !dragging && prepareDrag && liveDraftSupported() && workerFinalChosen() && !pageRenderChosen()
      && layersKey === '[]' && !frame.edit?.trueDetailAi && hasImage.current;
    const renderFinalInWorker = async (): Promise<HTMLCanvasElement | 'cancelled' | null> => {
      if (!workerCanDrawFinal()) return null;
      // Only for a kind of edit the worker has already drawn exactly as the page did, on this device (verifyWorker below).
      if (workerVerdict(renderSignature(frame.edit ?? DEFAULT_EDIT)) !== true) return null;
      if (cancelled) return 'cancelled';
      const draft = liveDraft();
      if (draft.baseKey(slot.current) !== draftKey || !baseFromRender.current.has(draftKey)) return null;
      const started = performance.now();
      const bitmap = await draft.draw(slot.current, draftKey, FULL_EDGE, frame.edit ?? DEFAULT_EDIT);
      if (cancelled) { bitmap?.close(); return 'cancelled'; }
      if (!bitmap) return null;
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      measureStep('preview:edit-worker', started, { width: canvas.width, height: canvas.height });
      return canvas;
    };

    const render = async () => {
      if (dragging && await renderDraft()) return;
      const fromWorker = await renderFinalInWorker();
      if (fromWorker === 'cancelled') return;
      if (fromWorker) {
        showLive(fromWorker);
        await finishFull(fromWorker, Math.max(fromWorker.width, fromWorker.height));
        return;
      }
      // A small thumbnail is plenty for a filmstrip card, and avoids decoding the full-size picture on every slider move.
      const source = await timedWait('preview:source', () => loadEditSource(frame, previewProvider, variant, priority));
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      const framing = frame.framing ?? DEFAULT_FRAMING;
      const size = framedSize(source.naturalWidth, source.naturalHeight, framing);
      const scale = Math.min(1, (variant === 'thumb' ? 400 : dragging ? shownEdge() : FULL_EDGE) / Math.max(size.width, size.height));
      timedStep('preview:draw-source', () => drawFramedPhoto(source, canvas, framing, { scale }));
      const lens = lensCentre(source.naturalWidth, source.naturalHeight, framing);
      // The full-resolution picture this render comes from, for the zoomed-in detail (wherever the edit is drawn).
      if (variant === 'full' && !dragging) {
        detailSource.current = { element: source, key: JSON.stringify([draftKey, source.currentSrc || source.src]), renderedLongEdge: Math.max(canvas.width, canvas.height) };
      }
      // The framed picture goes to the draft worker before the edit changes it, so the next drag starts at once.
      let baseSent: Promise<boolean> | null = null;
      if (variant === 'full' && !dragging && prepareDrag && liveDraftSupported()) {
        const key = draftKey;
        // Only a base from this full render (not one made from the shown file) is good for drawing the full-quality picture.
        baseSent = createImageBitmap(canvas).then((bitmap) => { liveDraft().sendBase(slot.current, key, bitmap, lens); baseFromRender.current.add(key); return true; }, () => false);
      }
      // Then the edit itself in the worker, from exactly these framed pixels (the same picture as drawing it here), once
      // the worker has been found to draw this kind of edit exactly as the page does.
      const signature = renderSignature(frame.edit ?? DEFAULT_EDIT);
      // Switched off: the worker is not trusted with this kind of edit, and nothing is compared (it costs the page nothing).
      if (baseSent && !workerFinalChosen() && workerVerdict(signature) === undefined) {
        recordWorkerVerdict(signature, false);
        measureStep('preview:worker-verify', performance.now(), { same: false, signature, off: true });
      }
      if (baseSent && workerCanDrawFinal() && workerVerdict(signature) === undefined) await verifyWorker(canvas, signature);
      if (cancelled) return;
      if (baseSent && workerCanDrawFinal() && workerVerdict(signature) === true && await baseSent) {
        const fromWorker = await renderFinalInWorker();
        if (fromWorker === 'cancelled') return;
        if (fromWorker) {
          showLive(fromWorker);
          await finishFull(fromWorker, Math.max(fromWorker.width, fromWorker.height));
          return;
        }
      }
      await preloadTrueDetailAi(frame.edit);
      if (cancelled) return;
      // The stage cache (x-std-stage-cache) keeps the picture after noise reduction, dehaze and the other early stages,
      // so dragging a later slider redraws from there. The key names exactly the pixels just drawn on the canvas.
      const sourceKey = JSON.stringify([identity, frame.originalSha256 ?? null, source.currentSrc || source.src, source.naturalWidth, source.naturalHeight, framing, scale]);
      timedStep('preview:edit', () => applyCanvasPhotoEdit(canvas, frame.edit ?? DEFAULT_EDIT, undefined, { ...fullContext(canvas.width, canvas.height), lensCentre: lens },
        { cache: liveStageCache(), sourceKey }), { width: canvas.width, height: canvas.height, dragging });
      await applyFrameLayers(canvas, frame.overlay, false, frame.edit?.masks);
      if (cancelled) return;
      showLive(canvas);
      if (dragging) return;
      await finishFull(canvas, Math.max(size.width, size.height) * scale);
    };

    /**
     * The first time this kind of edit is drawn (its signature): the page and the worker each apply it to the same small
     * copy of the framed picture (at most 640 px), and only if every byte matches is the worker trusted with this kind
     * of edit. The real edit, so every part of the maths it uses is compared; small, so the check costs the page little.
     */
    const verifyWorker = async (framed: HTMLCanvasElement, signature: string): Promise<void> => {
      const started = performance.now();
      if (!liveDraftSupported()) { recordWorkerVerdict(signature, false); return; }
      // At an idle moment, in a task of its own: a click or key waiting to be handled always goes first.
      await new Promise<void>((resolve) => {
        const whenIdle = (globalThis as { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
        if (whenIdle) whenIdle(() => resolve(), { timeout: 1000 }); else setTimeout(resolve, 0);
      });
      if (cancelled) return;
      const edit = frame.edit ?? DEFAULT_EDIT;
      const scale = Math.min(1, VERIFY_EDGE / Math.max(framed.width, framed.height));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(framed.width * scale)); small.height = Math.max(1, Math.round(framed.height * scale));
      const context = small.getContext('2d', { willReadFrequently: true });
      if (!context) { recordWorkerVerdict(signature, false); return; }
      context.imageSmoothingQuality = 'high';
      context.drawImage(framed, 0, 0, small.width, small.height);
      const before = context.getImageData(0, 0, small.width, small.height).data;
      const inWorker = liveDraft().check(small.width, small.height, before, edit);
      // Only the graphics-card step is compared: the rest of the edit is the same JavaScript on the page and in the worker,
      // so from the same pixels it gives the same bytes. That keeps the page's part to a few milliseconds.
      const onPage = timedStep('preview:verify-page', () => {
        const usedGpu = renderEditOnGpu(small, edit);
        return { usedGpu, pixels: context.getImageData(0, 0, small.width, small.height).data };
      });
      const answer = await inWorker;
      // Both sides must take the same path; where neither used its graphics card, both ran the same JavaScript.
      const same = Boolean(answer) && answer!.usedGpu === onPage.usedGpu && (!onPage.usedGpu || samePixels(onPage.pixels, answer!.pixels));
      recordWorkerVerdict(signature, same);
      measureStep('preview:worker-verify', started, { same, signature });
    };

    /** The 16-bit pass and the one PNG, for a full-quality picture drawn here or in the worker. */
    const finishFull = async (canvas: HTMLCanvasElement, eightBitEdge: number) => {
      // A new full-quality picture is on screen: the zoomed-in detail (useDetailRegion) is drawn again for it.
      if (variant === 'full') setRenderedRevision((count) => count + 1);
      // A redraw of a photo with a 16-bit copy shows the 8-bit picture at once, waits for the slider to be still, then
      // encodes only the 16-bit picture: one PNG per pause, not two.
      const tried16 = hasImage.current && sensor16Ready();
      if (tried16) {
        if (await drawSensor16(eightBitEdge).catch(() => false)) return;
        if (cancelled) return;
      }
      await encodeShown(canvas);
      if (cancelled || tried16) return;
      // Then, when this photo's 16-bit copy is ready, the same picture drawn from it (in a worker, so sliders stay free)
      // replaces it: only if the edit can be carried at 16 bits and the result is at least as detailed.
      await drawSensor16(eightBitEdge).catch(() => false);
    };

    /** Encode the finished picture once, for everything that reads it by its address (the image, its size, readiness). */
    const encodeShown = async (canvas: HTMLCanvasElement, precision?: 'rgb16') => {
      // A full-size edited view must not suffer a second lossy JPEG pass.
      // Thumbnails stay compact JPEGs; full previews use lossless PNG.
      const { mime, quality } = precision ? { mime: 'image/png', quality: undefined } : framePreviewEncoding(variant);
      const blob = await timedWait('preview:encode', () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality)), { precision });
      if (cancelled) return;
      if (!blob) throw new Error('Preview unavailable');
      const url = URL.createObjectURL(blob);
      fullShown = true;
      shownAt.current = performance.now();
      replaceRendered(url);
      setPreview(precision ? { identity, url, precision } : { identity, url });
    };

    // Only a redraw over a picture already shown: the first picture of a photo still arrives through the image.
    const showLive = (canvas: HTMLCanvasElement | ImageBitmap) => {
      const live = liveCanvas.current;
      if (variant !== 'full' || !hasImage.current || !live) return;
      const context = live.getContext('2d');
      if (!context) return;
      if (live.width !== canvas.width || live.height !== canvas.height) { live.width = canvas.width; live.height = canvas.height; }
      context.globalCompositeOperation = 'copy';
      context.drawImage(canvas, 0, 0);
      setLiveFor(identity);
    };
    const showLiveBitmap = (bitmap: ImageBitmap) => {
      try { showLive(bitmap); } finally { bitmap.close(); }
    };

    const sensor16Ready = () => Boolean(want16 && raw16Workings.ready(raw16Key(frame)));
    /** True when the 16-bit picture was drawn and is now the one shown. */
    const drawSensor16 = async (eightBitLongEdge: number): Promise<boolean> => {
      const working = want16 ? raw16Workings.ready(raw16Key(frame)) : undefined;
      if (!working) return false;
      // Only once the slider has been still for a moment: a pause mid-adjustment does not start a full 16-bit pass.
      await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, SENSOR16_SETTLE_MS); });
      if (cancelled) return false;
      const shownUrl = await previewProvider.getFullPreviewUrl(frame, 'selected');
      if (cancelled || !raw16Possible(frame, previewProvider.pictureSourceOf(shownUrl), canDevelopRaw())) return false;
      const screen = await timedWait('preview:raw16', () => renderRaw16Screen(slot.current, working, frame.edit ?? DEFAULT_EDIT, frame.framing));
      if (cancelled || !screen || !raw16SharpEnough(screen, eightBitLongEdge)) return false;
      const canvas = document.createElement('canvas');
      canvas.width = screen.width; canvas.height = screen.height;
      canvas.getContext('2d')!.putImageData(new ImageData(screen.rgba, screen.width, screen.height), 0, 0);
      await applyFrameLayers(canvas, frame.overlay, false);
      if (cancelled) return false;
      showLive(canvas);
      await encodeShown(canvas, 'rgb16');
      return !cancelled;
    };

    // A full-size view never stays an empty dark frame while a large original is verified and developed (a 45 MP RAW
    // can take many seconds): it shows the photo's thumbnail, with the same framing and edit, and keeps the
    // "Refreshing image" status until the full picture replaces it. The interim is never reported as ready.
    let fullShown = false;
    const showInterim = async () => {
      const source = await loadThumbSource(frame, previewProvider, true);
      if (cancelled || fullShown || hasImage.current) return;
      const canvas = document.createElement('canvas');
      const framing = frame.framing ?? DEFAULT_FRAMING;
      drawFramedPhoto(source, canvas, framing, { scale: 1 });
      if (edited) {
        applyCanvasPhotoEdit(canvas, frame.edit ?? DEFAULT_EDIT, undefined, { ...fullContext(canvas.width, canvas.height), lensCentre: lensCentre(source.naturalWidth, source.naturalHeight, framing) });
        await applyFrameLayers(canvas, frame.overlay, false, frame.edit?.masks);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob || cancelled || fullShown || hasImage.current) return;
      const url = URL.createObjectURL(blob);
      replaceRendered(url);
      setPreview({ identity, url, interim: true });
    };
    const interim = variant === 'full' && !hasImage.current ? showInterim() : null;
    interim?.catch(() => undefined);

    // Every retry failed: keep the small picture (being drawn just above) rather than a blank or broken frame.
    if (degraded) {
      if (!interim) { if (!hasImage.current) setPreview({ identity, url: '' }); setLoading(false); return () => { cancelled = true; }; }
      interim.then(() => { if (!cancelled) setLoading(false); }, () => { if (!cancelled) { setPreview({ identity, url: '' }); setLoading(false); } });
      return () => { cancelled = true; window.clearTimeout(timer); };
    }

    const load = async () => {
      // A retry waits a little first, so a picture that is being replaced (a develop finishing) has time to arrive.
      const wait = retries.current > 0 ? RETRY_WAITS_MS[Math.min(retries.current, RETRY_WAITS_MS.length) - 1] : 0;
      if (wait) {
        await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, wait); });
        if (cancelled) return;
      }
      if (edited || (want16 && raw16Workings.ready(raw16Key(frame)))) {
        // Wait for the edit to settle before redrawing, so dragging a slider does not redraw on every step.
        // While dragging, the worker takes only the newest step, so each one is sent at once.
        await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, !hasImage.current ? 0 : dragging && liveDraftSupported() ? 0 : 65); });
        if (cancelled) return;
        await render();
        return;
      }
      replaceRendered(undefined);
      const url =
        variant === 'full'
          ? await previewProvider.getFullPreviewUrl(frame, 'selected')
          : await previewProvider.getThumbnailUrl(frame, priority ? 'selected' : 'visible');
      if (!cancelled) {
        fullShown = true;
        // Release an interim thumbnail render once the full picture takes its place.
        replaceRendered(undefined);
        setPreview({ identity, url });
        setLoading(false);
        if (url && variant === 'full' && prepareDrag) prepareDraftFrom(url);
      }
    };

    /** An unedited photo: once it has been shown a moment, its file is decoded and framed in the drag worker (off this
     * thread), so the first drag on it starts at once. Never a RAW develop: only the picture already on screen. */
    const prepareDraftFrom = (url: string) => {
      if (!liveDraftSupported() || liveDraft().baseKey(slot.current) === draftKey) return;
      const key = draftKey, framing = frame.framing ?? DEFAULT_FRAMING;
      timer = window.setTimeout(() => {
        void fetch(url).then((response) => response.blob()).then((blob) => {
          if (!cancelled) liveDraft().sendBaseFile(slot.current, key, blob, framing, FULL_EDGE);
        }).catch(() => undefined);
      }, 400);
    };

    void load().catch(() => {
      if (cancelled) return;
      // A failed redraw keeps the last good picture. A photo that never had one tries again, then keeps the small
      // picture (marked as such, never reported as ready), and only then shows the placeholder.
      if (!hasImage.current || previewIsInterim.current) {
        if (retries.current < RETRY_WAITS_MS.length) {
          retries.current += 1;
          setSourceRevision((revision) => revision + 1);
          return;
        }
        onPreviewStatus?.(frame.id, 'unavailable');
        if (variant === 'full') { setDegraded(true); return; }
        fullShown = true;
        setPreview({ identity, url: '' });
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [frame.id, frame.stableKey, identity, frame.edit, frame.framing, layersKey, edited, previewProvider, variant, needsAccess, priority, nearViewport, onPreviewStatus, developedRev, raw16Rev, want16, degraded, settleRev, draftKey, prepareDrag]);

  const tryAgain = () => { retries.current = 0; setErrored(false); setDegraded(false); setSourceRevision((revision) => revision + 1); };

  const demoStyle: React.CSSProperties = {};
  if (!edited && frame.isDemo && frame.demoVariant) {
    const { panX, panY, cropScale, softnessPx } = frame.demoVariant;
    const totalScale = cropScale * zoomScale;
    const tx = panOffset.x + panX * 2.5;
    const ty = panOffset.y + panY * 2.5;
    demoStyle.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${totalScale})`;
    if (softnessPx > 0) {
      const scaledBlur = variant === 'full' ? softnessPx : Number((softnessPx * 0.5).toFixed(2));
      demoStyle.filter = `blur(${scaledBlur}px)`;
    }
  } else if (zoomScale !== 1 || panOffset.x !== 0 || panOffset.y !== 0) {
    demoStyle.transform = `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoomScale})`;
  }

  // The tidy placeholder, only once every retry and the small picture have failed. It says what is missing in words and
  // offers to try again; it never shows the browser's broken-image icon.
  const placeholder = (message?: string) => (
    <div
      data-testid="picture-unavailable"
      className={`flex flex-col items-center justify-center gap-0.5 bg-[#17191D] text-zinc-500 p-3 text-center select-none ${className}`}
    >
      <ImageOff className="w-5 h-5 mb-1 text-zinc-500" aria-hidden="true" />
      <span className="text-xs font-medium text-zinc-400 truncate max-w-full">{frame.filename}</span>
      {message && <span className="text-[11px] text-zinc-400">{message}</span>}
      {variant === 'full' && !needsAccess && (
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); tryAgain(); }}
          className="mt-1.5 rounded border border-zinc-500 px-2 py-0.5 text-[11px] font-medium text-zinc-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          {t.frame.tryAgain}
        </button>
      )}
    </div>
  );

  // Zoomed in past the drawn picture's resolution: the part on screen at full detail (useDetailRegion). Only for an edited
  // picture without image layers or a stored AI result (those are drawn on the page); an unedited picture already shows
  // its full-resolution preview as it is.
  const detailEnabled = variant === 'full' && prepareDrag && edited && !frame.isDemo && layersKey === '[]' && !frame.edit?.trueDetailAi;
  const detail = useDetailRegion({
    containerRef, sourceRef: detailSource, slot: slot.current, enabled: detailEnabled, edit: frame.edit ?? DEFAULT_EDIT,
    framing: frame.framing ?? DEFAULT_FRAMING, pictureKey: JSON.stringify([identity, frame.edit ?? null, frame.framing ?? null, developedRev, sourceRevision]),
    renderedRevision, onLoading: onDetailLoading, fit: imageSize?.fit ?? 'cover',
  });

  const unavailableNow = (!src && !loading && preview.identity === identity) || (errored && preview.identity === identity);
  const busy = !degraded && !unavailableNow && (loading || preview.identity !== identity || Boolean(src && preview.interim));
  const busyListener = useRef(onBusyChange);
  busyListener.current = onBusyChange;
  useEffect(() => { busyListener.current?.(busy); }, [busy]);
  useEffect(() => () => busyListener.current?.(false), []);

  if (!src && !loading && preview.identity === identity) {
    return placeholder(needsAccess ? t.frame.originalUnavailable : isHeifFile(frame.filename) && !frame.isDemo ? t.frame.heifUndecodable : t.frame.previewUnavailable);
  }

  if (errored && preview.identity === identity) {
    return placeholder();
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden bg-kestrel-stage ${className}`}>
      {degraded && src && preview.interim && (
        <div role="status" data-testid="picture-low-quality" className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-black/65 py-1 pl-2.5 pr-1 text-[11px] text-white">
          <span>{t.frame.lowQuality}</span>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); tryAgain(); }}
            className="rounded-full border border-white/60 px-2 py-0.5 font-medium hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            {t.frame.tryAgain}
          </button>
        </div>
      )}
      {!degraded && (loading || preview.identity !== identity) && (!src ? (
        <div className="absolute inset-0 bg-[#181A1E] motion-safe:animate-pulse" aria-hidden="true" />
      ) : (
        <div role="status" aria-label={retries.current > 0 ? t.frame.retrying : 'Refreshing image'} className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full bg-black/65 p-2 text-white">
          <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        </div>
      ))}
      {src && (
        <img
          key={src}
          src={src}
          alt={alt ?? frame.demoVariant?.demoSceneLabel ?? frame.filename}
          referrerPolicy="no-referrer"
          draggable={false}
          loading={variant === 'thumb' ? 'lazy' : 'eager'}
          data-preview-quality={preview.interim ? 'interim' : 'full'}
          data-precision={preview.interim ? undefined : preview.precision}
          onLoad={(event) => {
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            if (width > 0 && height > 0) onPictureSize?.({ width, height });
            // The interim thumbnail keeps the refresh status on and is not reported as the photo's preview.
            if (preview.interim) return;
            if (shownAt.current !== null) { measureStep('preview:decode', shownAt.current); shownAt.current = null; }
            setLiveFor(null);
            retries.current = 0;
            // The outline must follow the picture exactly, including a border frame that switches it to object-contain.
            const fit = getComputedStyle(event.currentTarget).objectFit === 'contain' ? 'contain' : 'cover';
            setImageSize({ src, width, height, fit });
            setLoading(false);
            onPreviewStatus?.(frame.id, 'ready');
          }}
          onError={() => {
            if (preview.interim) return;
            // The address died (a revoked preview, a develop replacing it): ask again, showing the small picture meanwhile.
            if (retries.current < RETRY_WAITS_MS.length) {
              retries.current += 1;
              replaceRendered(undefined);
              setPreview({ identity, url: '' });
              setSourceRevision((revision) => revision + 1);
              return;
            }
            if (variant === 'full') {
              replaceRendered(undefined);
              setPreview({ identity, url: '' });
              setDegraded(true);
              onPreviewStatus?.(frame.id, 'unavailable');
              return;
            }
            setErrored(true);
            setLoading(false);
            onPreviewStatus?.(frame.id, 'unavailable');
          }}
          style={demoStyle}
          className={`w-full h-full select-none motion-safe:transition-opacity motion-safe:duration-150 ${
            loading && !src ? 'opacity-0' : 'opacity-100'
          } ${edited && variant === 'thumb' ? 'object-contain' : imgClassName}`}
        />
      )}
      {detailEnabled && (
        <canvas ref={detail.canvasRef} data-testid="detail-picture" aria-hidden="true" data-detail-scale={detail.shown?.plan.scale}
          style={detail.shown && src ? { left: `${detail.shown.plan.place.left}%`, top: `${detail.shown.plan.place.top}%`,
            width: `${detail.shown.plan.place.width}%`, height: `${detail.shown.plan.place.height}%` } : { display: 'none' }}
          className="pointer-events-none absolute select-none" />
      )}
      {variant === 'full' && (
        <canvas ref={liveCanvas} data-testid="live-picture" aria-hidden="true" 
          style={{ ...demoStyle, display: src && liveFor === identity ? undefined : 'none' }} className={`pointer-events-none absolute inset-0 w-full h-full select-none ${imgClassName}`} />
      )}
      {src && imageSize?.src === src && maskGuideId && frame.edit?.masks && (
        <MaskCoverageImage key={`${src}:${maskGuideId}:${maskGuideStyle}`} src={src} masks={frame.edit.masks} maskId={maskGuideId} guideStyle={maskGuideStyle} zoom={guideZoom}
          width={imageSize.width} height={imageSize.height} className={imgClassName} style={demoStyle} />
      )}
      {/* Kept through an edit redraw (same picture size), so the outline does not blink while a slider moves. */}
      {src && imageSize && maskOutline && (
        <svg data-testid="mask-outline-layer" viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
          preserveAspectRatio={imageSize.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}
          className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-hidden" style={demoStyle}>
          {maskOutline({ width: imageSize.width, height: imageSize.height })}
        </svg>
      )}
    </div>
  );
};

/** Render the same effective mask weights as the editor. The overlay is a separate non-interactive image, so
 * it follows object-fit, crop, rotation and zoom and can never enter an export recipe. */
function MaskCoverageImage({ src, masks, maskId, guideStyle, zoom, width, height, className, style }: {
  src: string; masks: readonly Mask[]; maskId: string; guideStyle: MaskGuideStyle; zoom?: number; width: number; height: number; className: string; style: React.CSSProperties;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const guideImage = useRef<HTMLImageElement>(null);
  // The guide is drawn as finely as it is shown (screen pixels), in steps, so zooming in never stretches a coarse raster
  // into a staircase. Measured a moment after the zoom settles, so a pinch does not redraw it every frame.
  const [edge, setEdge] = useState<number | undefined>(undefined);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const box = guideImage.current?.getBoundingClientRect();
      if (!box) return;
      const next = guideEdgeFor(Math.max(box.width, box.height) * (window.devicePixelRatio || 1), guideStyle);
      setEdge((current) => (current === next ? current : next));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [zoom, guideStyle, url]);
  // A brightness mask is measured from the picture shown, loaded once for the guide.
  const [shown, setShown] = useState<HTMLImageElement | null>(null);
  const needsPicture = masks.some(mask => mask.kind === 'tonal');
  useEffect(() => {
    if (!needsPicture) { setShown(null); return; }
    let live = true;
    const image = new Image();
    image.onload = () => { if (live) setShown(image); };
    image.src = src;
    return () => { live = false; };
  }, [src, needsPicture]);
  useEffect(() => {
    const brightness = shown ? (w: number, h: number) => {
      const reader = document.createElement('canvas');
      reader.width = w; reader.height = h;
      const read = reader.getContext('2d', { willReadFrequently: true });
      if (!read) return undefined;
      read.drawImage(shown, 0, 0, w, h);
      return lumaFromRgba8(read.getImageData(0, 0, w, h).data);
    } : undefined;
    const guide = maskCoverageGuide(masks, maskId, width, height, guideStyle, edge, brightness);
    if (!guide) { setUrl(null); return; }
    const canvas = document.createElement('canvas');
    canvas.width = guide.width; canvas.height = guide.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setUrl(null); return; }
    const pixels = ctx.createImageData(guide.width, guide.height);
    pixels.data.set(guide.rgba);
    ctx.putImageData(pixels, 0, 0);
    setUrl(canvas.toDataURL('image/png'));
  }, [masks, maskId, guideStyle, width, height, edge, shown]);
  if (!url || !masks.some(mask => mask.id === maskId && !mask.hidden)) return null;
  return <img ref={guideImage} src={url} alt="" aria-hidden="true" draggable={false} data-testid="mask-coverage-guide" data-style={guideStyle}
    className={`pointer-events-none absolute inset-0 h-full w-full z-10 ${className}`} style={style} />;
}

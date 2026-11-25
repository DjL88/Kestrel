import { maskCoverageGuide } from '../core/maskCoverageGuide';
import type { Mask } from '../core/maskTypes';
import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { preloadTrueDetailAi } from '../core/trueDetailAiCanvas';
import { frameLayers, visibleLayers } from '../core/layers';
import { applyFrameLayers } from '../core/layerAssetVault';
import { frameImageIdentity, framePreviewEncoding, visibleFrameUrl } from '../core/frameImageIdentity';
import { DEFAULT_EDIT, isNeutralEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize, lensCentre } from '../core/photoFraming';
import { fullContext } from '../core/masks';
import { loadImage } from '../providers/loadImage';
import { loadExportSource } from '../providers/browserExport';
import { raw16Key, raw16Possible, raw16SharpEnough, raw16WorkingFor, raw16Workings } from '../providers/raw16Working';
import { renderRaw16Screen } from '../providers/raw16Render';
import { canDevelopRaw } from '../providers/rawDevelop';
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
  /** Optional editor-only SVG content drawn in the displayed picture's own pixels (mask outline and handles). */
  maskOutline?: (picture: { width: number; height: number }) => React.ReactNode;
  /** Optional interactive transform for zoom/pan viewports */
  zoomScale?: number;
  panOffset?: { x: number; y: number };
  /** V2 editor: when the picture is InFlight's own RAW develop, draw it from the 16-bit develop with the 16-bit edit maths. */
  sensor16?: boolean;
  /** The shown picture's pixel size, each time one loads (the interim one included): its shape for format geometry. */
  onPictureSize?: (size: { width: number; height: number }) => void;
}

/** A picture that will not load is asked for again this many times, after these waits, before the view settles for less. */
const RETRY_WAITS_MS = [150, 900, 2500];

/** The picture an edit is drawn from: the full source, else the full preview as shown, else the small thumbnail. A
 * view never stays unedited or blank because the original (or a RAW develop) is not available on this device. */
async function loadEditSource(frame: PhotoFrame, provider: BrowserPreviewProvider, variant: 'thumb' | 'full', priority: boolean): Promise<HTMLImageElement> {
  if (variant === 'thumb') return loadThumbSource(frame, provider, priority);
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
  maskOutline,
  zoomScale = 1,
  panOffset = { x: 0, y: 0 },
  sensor16 = false,
  onPictureSize,
}) => {
  // Keep a finished render for same-frame slider updates, never for a different photo.
  const [sourceRevision, setSourceRevision] = useState(0);
  const identity = frameImageIdentity(frame, variant, sourceRevision);
  // `interim`: the small filmstrip picture shown in the full-size view until the full picture is ready (never reported as ready).
  // `precision`: 'rgb16' when the picture was drawn from the 16-bit RAW develop (one rounding to the screen).
  const [preview, setPreview] = useState<{ identity: string; url: string; interim?: boolean; precision?: 'rgb16' }>({ identity: '', url: '' });
  const src = visibleFrameUrl(preview, identity);
  const [imageSize, setImageSize] = useState<{ src: string; width: number; height: number; fit: 'cover' | 'contain' } | null>(null);
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
  const previewIsInterim = useRef(false);
  previewIsInterim.current = Boolean(src && preview.interim);
  // An interim thumbnail does not count: an edit redraw must still be able to replace it with a full render.
  hasImage.current = Boolean(src) && !preview.interim;
  const renderedUrl = useRef<string | undefined>(undefined);
  // The last rendered picture is only released once a newer one replaces it, or on unmount, so it never goes blank mid-edit.
  const replaceRendered = (next: string | undefined) => {
    const previous = renderedUrl.current;
    renderedUrl.current = next;
    if (previous && previous !== next) window.setTimeout(() => URL.revokeObjectURL(previous), 1000);
  };
  useEffect(() => () => replaceRendered(undefined), []);

  useEffect(() => {
    if (variant === 'thumb' && !nearViewport && !priority) return;
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

    const render = async () => {
      // A small thumbnail is plenty for a filmstrip card, and avoids decoding the full-size picture on every slider move.
      const source = await loadEditSource(frame, previewProvider, variant, priority);
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      const framing = frame.framing ?? DEFAULT_FRAMING;
      const size = framedSize(source.naturalWidth, source.naturalHeight, framing);
      const scale = Math.min(1, (variant === 'thumb' ? 400 : 2200) / Math.max(size.width, size.height));
      drawFramedPhoto(source, canvas, framing, { scale });
      await preloadTrueDetailAi(frame.edit);
      if (cancelled) return;
      applyCanvasPhotoEdit(canvas, frame.edit ?? DEFAULT_EDIT, undefined, { ...fullContext(canvas.width, canvas.height), lensCentre: lensCentre(source.naturalWidth, source.naturalHeight, framing) });
      await applyFrameLayers(canvas, frame.overlay, false, frame.edit?.masks);
      if (cancelled) return;
      // A full-size edited view must not suffer a second lossy JPEG pass.
      // Thumbnails stay compact JPEGs; full previews use lossless PNG.
      const { mime, quality } = framePreviewEncoding(variant);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
      if (cancelled) return;
      if (!blob) throw new Error('Preview unavailable');
      const url = URL.createObjectURL(blob);
      fullShown = true;
      replaceRendered(url);
      setPreview({ identity, url });
      // Then, when this photo's 16-bit copy is ready, the same picture drawn from it (in a worker, so sliders stay free)
      // replaces it: only if the edit can be carried at 16 bits and the result is at least as detailed.
      await drawSensor16(Math.max(size.width, size.height) * scale).catch(() => undefined);
    };

    const drawSensor16 = async (eightBitLongEdge: number) => {
      const working = want16 ? raw16Workings.ready(raw16Key(frame)) : undefined;
      if (!working) return;
      const shownUrl = await previewProvider.getFullPreviewUrl(frame, 'selected');
      if (cancelled || !raw16Possible(frame, previewProvider.pictureSourceOf(shownUrl), canDevelopRaw())) return;
      const screen = await renderRaw16Screen(slot.current, working, frame.edit ?? DEFAULT_EDIT, frame.framing);
      if (cancelled || !screen || !raw16SharpEnough(screen, eightBitLongEdge)) return;
      const canvas = document.createElement('canvas');
      canvas.width = screen.width; canvas.height = screen.height;
      canvas.getContext('2d')!.putImageData(new ImageData(screen.rgba, screen.width, screen.height), 0, 0);
      await applyFrameLayers(canvas, frame.overlay, false);
      if (cancelled) return;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (cancelled || !blob) return;
      const url = URL.createObjectURL(blob);
      replaceRendered(url);
      setPreview({ identity, url, precision: 'rgb16' });
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
        await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, hasImage.current ? 65 : 0); });
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
      }
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
  }, [frame.id, frame.stableKey, identity, frame.edit, frame.framing, layersKey, edited, previewProvider, variant, needsAccess, priority, nearViewport, onPreviewStatus, developedRev, raw16Rev, want16, degraded]);

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
      {src && imageSize?.src === src && maskGuideId && frame.edit?.masks && (
        <MaskCoverageImage key={`${src}:${maskGuideId}`} masks={frame.edit.masks} maskId={maskGuideId}
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
function MaskCoverageImage({ masks, maskId, width, height, className, style }: {
  masks: readonly Mask[]; maskId: string; width: number; height: number; className: string; style: React.CSSProperties;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const guide = maskCoverageGuide(masks, maskId, width, height);
    if (!guide) { setUrl(null); return; }
    const canvas = document.createElement('canvas');
    canvas.width = guide.width; canvas.height = guide.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setUrl(null); return; }
    const pixels = ctx.createImageData(guide.width, guide.height);
    pixels.data.set(guide.rgba);
    ctx.putImageData(pixels, 0, 0);
    setUrl(canvas.toDataURL('image/png'));
  }, [masks, maskId, width, height]);
  if (!url || !masks.some(mask => mask.id === maskId && !mask.hidden)) return null;
  return <img src={url} alt="" aria-hidden="true" draggable={false} data-testid="mask-coverage-guide"
    className={`pointer-events-none absolute inset-0 h-full w-full z-10 ${className}`} style={style} />;
}

import { maskCoverageGuide } from '../core/maskCoverageGuide';
import type { Mask } from '../core/maskTypes';
import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { frameImageIdentity, framePreviewEncoding, visibleFrameUrl } from '../core/frameImageIdentity';
import { DEFAULT_EDIT, isNeutralEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../core/photoFraming';
import { loadImage } from '../providers/loadImage';
import { loadExportSource } from '../providers/browserExport';
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
  /** Optional interactive transform for zoom/pan viewports */
  zoomScale?: number;
  panOffset?: { x: number; y: number };
}

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
  zoomScale = 1,
  panOffset = { x: 0, y: 0 },
}) => {
  // Keep a finished render for same-frame slider updates, never for a different photo.
  const [sourceRevision, setSourceRevision] = useState(0);
  const identity = frameImageIdentity(frame, variant, sourceRevision);
  // `interim`: the small filmstrip picture shown in the full-size view until the full picture is ready (never reported as ready).
  const [preview, setPreview] = useState<{ identity: string; url: string; interim?: boolean }>({ identity: '', url: '' });
  const src = visibleFrameUrl(preview, identity);
  const [imageSize, setImageSize] = useState<{ src: string; width: number; height: number } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errored, setErrored] = useState<boolean>(false);
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
    previewProvider.events.addEventListener('preview-invalidated', onInvalidate);
    return () => previewProvider.events.removeEventListener('preview-invalidated', onInvalidate);
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

  const edited = Boolean((frame.edit && !isNeutralEdit(frame.edit)) || (frame.framing &&
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
      const source = variant === 'thumb' ? await loadThumbSource(frame, previewProvider, priority) : await loadExportSource(frame, previewProvider, 'selected');
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      const framing = frame.framing ?? DEFAULT_FRAMING;
      const size = framedSize(source.naturalWidth, source.naturalHeight, framing);
      drawFramedPhoto(source, canvas, framing, { scale: Math.min(1, (variant === 'thumb' ? 400 : 2200) / Math.max(size.width, size.height)) });
      applyCanvasPhotoEdit(canvas, frame.edit ?? DEFAULT_EDIT);
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
      if (edited) applyCanvasPhotoEdit(canvas, frame.edit ?? DEFAULT_EDIT);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob || cancelled || fullShown || hasImage.current) return;
      const url = URL.createObjectURL(blob);
      replaceRendered(url);
      setPreview({ identity, url, interim: true });
    };
    if (variant === 'full' && !hasImage.current) void showInterim().catch(() => undefined);

    const load = async () => {
      if (edited) {
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
      fullShown = true;
      // A failed redraw keeps the last good picture. Only a photo that never had one shows the fallback.
      // An interim thumbnail is not a good picture: it must not stand in for a full view that failed.
      if (!hasImage.current || previewIsInterim.current) {
        if (previewIsInterim.current) replaceRendered(undefined);
        setPreview({ identity, url: '' });
        onPreviewStatus?.(frame.id, 'unavailable');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [frame.id, frame.stableKey, identity, frame.edit, frame.framing, edited, previewProvider, variant, needsAccess, priority, nearViewport, onPreviewStatus, developedRev]);

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

  if (!src && !loading && preview.identity === identity) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#17191D] text-zinc-500 p-3 text-center select-none ${className}`}
      >
        <ImageOff className="w-5 h-5 mb-1.5 text-zinc-500" aria-hidden="true" />
        <span className="text-xs font-medium text-zinc-400 truncate max-w-full">
          {frame.filename}
        </span>
        <span className="text-[11px] text-zinc-400 mt-0.5">
          {needsAccess ? t.frame.originalUnavailable : isHeifFile(frame.filename) && !frame.isDemo ? t.frame.heifUndecodable : t.frame.previewUnavailable}
        </span>
      </div>
    );
  }

  if (errored && preview.identity === identity) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#17191D] text-zinc-500 p-3 text-center select-none ${className}`}
      >
        <ImageOff className="w-5 h-5 mb-1.5 text-zinc-500" aria-hidden="true" />
        <span className="text-xs text-zinc-400 truncate max-w-full">{frame.filename}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden bg-kestrel-stage ${className}`}>
      {(loading || preview.identity !== identity) && (!src ? (
        <div className="absolute inset-0 bg-[#181A1E] motion-safe:animate-pulse" aria-hidden="true" />
      ) : (
        <div role="status" aria-label="Refreshing image" className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full bg-black/65 p-2 text-white">
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
          onLoad={(event) => {
            // The interim thumbnail keeps the refresh status on and is not reported as the photo's preview.
            if (preview.interim) return;
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            setImageSize({ src, width, height });
            setLoading(false);
            onPreviewStatus?.(frame.id, 'ready');
          }}
          onError={() => {
            if (preview.interim) return;
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

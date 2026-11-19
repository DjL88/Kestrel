import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { DEFAULT_EDIT, isNeutralEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../core/photoFraming';
import { loadImage } from '../providers/loadImage';
import { loadExportSource } from '../providers/browserExport';
import React, { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { PhotoFrame } from '../core/types';
import type { PhotoPreviewReadiness } from '../core/photoTileReadiness';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

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
  /** Reports actual image readiness; never inferred from the catalogue row existing. */
  onPreviewStatus?: (frameId: string, status: PhotoPreviewReadiness) => void;
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
  onPreviewStatus,
  zoomScale = 1,
  panOffset = { x: 0, y: 0 },
}) => {
  const [src, setSrc] = useState<string>('');
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

  const edited = Boolean((frame.edit && !isNeutralEdit(frame.edit)) || (frame.framing &&
    (frame.framing.ratio || frame.framing.turns || frame.framing.straighten)));

  const hasImage = useRef(false);
  hasImage.current = Boolean(src);
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
    // Keep showing the current picture while an edited one is being redrawn.
    if (!hasImage.current) setLoading(true);
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
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (cancelled) return;
      if (!blob) throw new Error('Preview unavailable');
      const url = URL.createObjectURL(blob);
      replaceRendered(url);
      setSrc(url);
    };

    const load = async () => {
      if (edited) {
        // Wait for the edit to settle before redrawing, so dragging a slider does not redraw on every step.
        await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, hasImage.current ? 200 : 0); });
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
        setSrc(url);
        setLoading(false);
      }
    };

    void load().catch(() => {
      if (cancelled) return;
      // A failed redraw keeps the last good picture. Only a photo that never had one shows the fallback.
      if (!hasImage.current) {
        setSrc('');
        onPreviewStatus?.(frame.id, 'unavailable');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [frame.id, frame.edit, frame.framing, edited, previewProvider, variant, needsAccess, priority, nearViewport, onPreviewStatus]);

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

  if (!src && !loading) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#17191D] text-zinc-500 p-3 text-center select-none ${className}`}
      >
        <ImageOff className="w-5 h-5 mb-1.5 text-zinc-500" aria-hidden="true" />
        <span className="text-xs font-medium text-zinc-400 truncate max-w-full">
          {frame.filename}
        </span>
        <span className="text-[11px] text-zinc-400 mt-0.5">
          {needsAccess ? 'Original unavailable — reconnect its folder or drive' : 'Preview unavailable'}
        </span>
      </div>
    );
  }

  if (errored) {
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
      {loading && (
        <div
          className="absolute inset-0 bg-[#181A1E] motion-safe:animate-pulse"
          aria-hidden="true"
        />
      )}
      {src && (
        <img
          src={src}
          alt={alt ?? frame.demoVariant?.demoSceneLabel ?? frame.filename}
          referrerPolicy="no-referrer"
          draggable={false}
          loading={variant === 'thumb' ? 'lazy' : 'eager'}
          onLoad={() => {
            setLoading(false);
            onPreviewStatus?.(frame.id, 'ready');
          }}
          onError={() => {
            setErrored(true);
            setLoading(false);
            onPreviewStatus?.(frame.id, 'unavailable');
          }}
          style={demoStyle}
          className={`w-full h-full select-none motion-safe:transition-opacity motion-safe:duration-150 ${
            loading ? 'opacity-0' : 'opacity-100'
          } ${edited && variant === 'thumb' ? 'object-contain' : imgClassName}`}
        />
      )}
    </div>
  );
};

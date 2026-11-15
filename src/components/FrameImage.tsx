import { applyCanvasPhotoEdit, DEFAULT_EDIT, isNeutralEdit } from '../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../core/photoFraming';
import { loadExportSource } from '../providers/browserExport';
import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

interface FrameImageProps {
  frame: PhotoFrame;
  previewProvider: BrowserPreviewProvider;
  variant: 'thumb' | 'full';
  className?: string;
  imgClassName?: string;
  alt?: string;
  needsAccess?: boolean;
  /** Optional interactive transform for zoom/pan viewports */
  zoomScale?: number;
  panOffset?: { x: number; y: number };
}

export const FrameImage: React.FC<FrameImageProps> = ({
  frame,
  previewProvider,
  variant,
  className = '',
  imgClassName = '',
  alt,
  needsAccess = false,
  zoomScale = 1,
  panOffset = { x: 0, y: 0 },
}) => {
  const [src, setSrc] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [errored, setErrored] = useState<boolean>(false);

  const edited = Boolean((frame.edit && !isNeutralEdit(frame.edit)) || (frame.framing &&
    (frame.framing.ratio || frame.framing.turns || frame.framing.straighten)));

  useEffect(() => {
    let cancelled = false;
    let renderedUrl: string | undefined;
    setLoading(true);
    setErrored(false);

    const load = async () => {
      if (edited) {
        const source = await loadExportSource(frame, previewProvider);
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        const framing = frame.framing ?? DEFAULT_FRAMING;
        const size = framedSize(source.naturalWidth, source.naturalHeight, framing);
        drawFramedPhoto(source, canvas, framing, { scale: Math.min(1, (variant === 'thumb' ? 400 : 2200) / Math.max(size.width, size.height)) });
        applyCanvasPhotoEdit(canvas, frame.edit ?? DEFAULT_EDIT);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (cancelled) return;
        if (!blob) throw new Error('Preview unavailable');
        renderedUrl = URL.createObjectURL(blob);
        setSrc(renderedUrl);
        return;
      }
      const url =
        variant === 'full'
          ? await previewProvider.getFullPreviewUrl(frame)
          : await previewProvider.getThumbnailUrl(frame);
      if (!cancelled) {
        setSrc(url);
        setLoading(false);
      }
    };

    void load().catch(() => {
      if (!cancelled) { setSrc(''); setLoading(false); }
    });
    return () => {
      cancelled = true;
      if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    };
  }, [frame.id, frame.edit, frame.framing, edited, previewProvider, variant, needsAccess]);

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
        <span className="text-[11px] text-zinc-500 mt-0.5">
          {needsAccess ? 'Folder permission needed' : 'Preview unavailable'}
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
    <div className={`relative overflow-hidden bg-[#0B0C0E] ${className}`}>
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
          onLoad={() => setLoading(false)}
          onError={() => {
            setErrored(true);
            setLoading(false);
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

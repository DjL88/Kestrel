import { useSyncExternalStore } from 'react';
import { FrameImage } from '../../components/FrameImage';
import type { PhotoSurfaceProps } from '../ui/contract';
import { surfaceBridge } from './surfaceBridge';

/** Draws a photo through the app's own pipeline (FrameImage: the develop and edit canvas, embedded or developed preview).
 * 'original' is the same photo with no edit, so Before and After come from the same source and differ only by the recipe. */
export function EngineSurface({ photoId, variant, alt, className, style }: PhotoSurfaceProps) {
  const { frames, provider } = useSyncExternalStore(surfaceBridge.subscribe, surfaceBridge.get);
  const frame = frames.get(photoId);
  if (!frame || !provider) return null;
  const shown = variant === 'original' ? { ...frame, edit: undefined } : frame;
  return (
    <div className={className} style={style}>
      <FrameImage frame={shown} previewProvider={provider} variant="full" needsAccess={false} priority alt={alt}
        className="h-full w-full" imgClassName="h-full w-full object-cover" />
    </div>
  );
}

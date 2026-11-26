import { useSyncExternalStore } from 'react';
import { FrameImage } from '../../components/FrameImage';
import type { PhotoSurfaceProps } from '../ui/contract';
import { surfaceBridge } from './surfaceBridge';
import { previewLookEdit } from './recipeMap';

/** Draws a photo through the app's own pipeline (FrameImage: the develop and edit canvas, embedded or developed preview).
 * 'original' is the same photo with no edit, so Before and After come from the same source and differ only by the recipe. */
export function EngineSurface({ photoId, variant, lookPreview, alt, className, style, maskGuideId, maskGuideStyle, maskOutline, onPictureSize, onBusyChange }: PhotoSurfaceProps) {
  const { frames, provider } = useSyncExternalStore(surfaceBridge.subscribe, surfaceBridge.get);
  const frame = frames.get(photoId);
  if (!frame || !provider) return null;
  const shown = variant === 'original'
    ? { ...frame, edit: undefined, overlay: undefined } // Before: the photo alone, without its edit or layers
    : lookPreview ? { ...frame, edit: previewLookEdit(frame.edit, lookPreview) } : frame;
  return (
    <div className={className} style={style}>
      <FrameImage frame={shown} previewProvider={provider} variant="full" needsAccess={false} priority refreshOnBackgroundDevelop sensor16 alt={alt} maskGuideId={variant === 'edited' ? maskGuideId : undefined} maskGuideStyle={maskGuideStyle ?? 'outline'}
        maskOutline={variant === 'edited' ? maskOutline : undefined}
        onPictureSize={onPictureSize} onBusyChange={onBusyChange} className="h-full w-full" imgClassName="h-full w-full object-cover" />
    </div>
  );
}

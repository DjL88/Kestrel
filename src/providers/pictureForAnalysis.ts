import { DEFAULT_FRAMING, drawFramedPhoto } from '../core/photoFraming';
import type { PhotoFrame } from '../core/types';
import { loadImage } from './loadImage';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

/** A small, upright picture of a photo for the models to look at, or null when the file is not available. */
export async function pictureForAnalysis(provider: BrowserPreviewProvider, frame: PhotoFrame, edge = 448): Promise<HTMLCanvasElement | null> {
  const url = await provider.getFullPreviewUrl(frame);
  if (!url) return null;
  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  drawFramedPhoto(image, canvas, { ...DEFAULT_FRAMING, turns: frame.framing?.turns ?? 0 }, { scale: Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight)) });
  return canvas;
}

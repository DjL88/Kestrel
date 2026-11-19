import { scorePreview, scoreWithSubject, type CullSuggestion, type SubjectFinding } from '../core/autoCull';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { loadImage } from './loadImage';
import { findSubject } from './objectDetector';

export interface CullImageObservation {
  result: CullSuggestion;
  base?: CullSuggestion;
  detectorFailed: boolean;
}

/**
 * Same preview pixels and subject scoring for early import and final cull.
 * This is *observation*, not a decision: a shoot-wide duplicate check, model
 * health fallback, keeper cap and user's current choices still come later.
 */
export async function observeCullImage(
  frame: PhotoFrame,
  provider: BrowserPreviewProvider,
  signal: AbortSignal,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  tryDetector: boolean,
): Promise<CullImageObservation> {
  const unavailable: CullSuggestion = {
    frameId: frame.id, decision: null, confidence: 'low', score: 0, reason: 'unavailable',
  };
  try {
    signal.throwIfAborted();
    const url = await provider.getFullPreviewUrl(frame, 'background');
    if (!url) return { result: unavailable, detectorFailed: false };
    const image = await loadImage(url);
    signal.throwIfAborted();
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const base = scorePreview(frame.id, context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width, canvas.height);
    if (!tryDetector) return { result: base, base, detectorFailed: false };

    try {
      const found = await findSubject(image, signal);
      signal.throwIfAborted();
      const finding: SubjectFinding | null = found && {
        label: found.detection.label, score: found.detection.score,
        size: Math.max(found.detection.box.w, found.detection.box.h), sharpness: found.sharpness,
      };
      return { result: scoreWithSubject(base, finding), base, detectorFailed: false };
    } catch {
      signal.throwIfAborted();
      return { result: base, base, detectorFailed: true };
    }
  } catch {
    signal.throwIfAborted();
    return { result: unavailable, detectorFailed: false };
  }
}

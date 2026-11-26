import { scorePreview, scoreWithSubjects, type CullSuggestion, type SubjectFinding } from '../core/autoCull';
import type { PhotoFrame } from '../core/types';
import type { PictureSource } from '../core/pictureSource';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { loadImage } from './loadImage';
import { findSubjectsSamePass } from './objectDetector';
import { sharedCullObservationPool } from './cullObservationPool';
import { subjectMasks, subjectSharpness, type Context2D, type Segment } from './cullObservationCompute';
import { cullMaskSharpnessOn } from '../core/maskSharpness';

/** EfficientSAM-Ti box masks on this thread's path, only with the masked-sharpness preview on and the pack installed. */
async function mainThreadSegment(): Promise<Segment | null> {
  if (!cullMaskSharpnessOn()) return null;
  try {
    const { tapSelectStatus, segmentBoxes } = await import('./tapSelect');
    return await tapSelectStatus() === 'ready' ? segmentBoxes : null;
  } catch {
    return null;
  }
}

const canvasContext = (width: number, height: number): Context2D | null => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d', { willReadFrequently: true }) as unknown as Context2D | null;
};

/** The RF-DETR tandem runs on the main thread only, so with that pack installed the workers are not used. */
async function tandemInstalled(): Promise<boolean> {
  const { rfDetrStatus } = await import('./rfDetrDetector');
  return (await rfDetrStatus().catch(() => 'unavailable')) === 'ready';
}

export interface CullImageObservation {
  result: CullSuggestion;
  base?: CullSuggestion;
  detectorFailed: boolean;
  /** Which picture was judged, as the preview provider recorded it (camera preview or developed from the RAW). */
  source?: PictureSource;
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
    const source = provider.pictureSourceOf(url);
    // Off the interface thread when it can be: a worker decodes, scores and runs the detector, and posts back
    // numbers only. Same evidence, same rules; any worker failure is treated like a failure here.
    const pool = await sharedCullObservationPool();
    if (pool && !(tryDetector && await tandemInstalled())) {
      const blob = await fetch(url).then((response) => {
        if (!response.ok) throw new Error('The preview could not be read.');
        return response.blob();
      });
      signal.throwIfAborted();
      const observed = await pool.observe(frame.id, blob, tryDetector).catch(() => null);
      signal.throwIfAborted();
      // A worker that died mid-photo: this photo is looked at here instead, the way it always was.
      if (observed) return { ...observed, source };
    }
    const image = await loadImage(url);
    signal.throwIfAborted();
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const base = scorePreview(frame.id, context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width, canvas.height);
    if (!tryDetector) return { result: base, base, detectorFailed: false, source };

    try {
      // Every subject is checked on its own; the frame is only as good as its weakest main subject (decision 6).
      const found = await findSubjectsSamePass(image, signal);
      signal.throwIfAborted();
      let findings: SubjectFinding[] = found.map((subject) => ({
        label: subject.detection.label, score: subject.detection.score,
        size: Math.max(subject.detection.box.w, subject.detection.box.h), sharpness: subject.sharpness,
      }));
      // Masked-sharpness preview: the same measurement as the workers make, inside each subject's mask.
      const segment = found.length ? await mainThreadSegment() : null;
      if (segment) {
        const picture = await createImageBitmap(image);
        try {
          const boxes = found.map((subject) => subject.detection.box);
          const masks = await subjectMasks(canvasContext, picture, boxes, segment);
          signal.throwIfAborted();
          findings = findings.map((finding, i) => masks[i] ? { ...finding, ...subjectSharpness(canvasContext, picture, boxes[i], masks[i]) } : finding);
        } finally {
          picture.close();
        }
      }
      return { result: scoreWithSubjects(base, findings), base, detectorFailed: false, source };
    } catch {
      signal.throwIfAborted();
      return { result: base, base, detectorFailed: true, source };
    }
  } catch {
    signal.throwIfAborted();
    return { result: unavailable, detectorFailed: false };
  }
}

import { findEye, lumaOf, type EyeCandidate } from '../core/eyeFinder';
import { subjectWeights } from '../core/naturalAuto';
import { GUIDED_RENDER_EDGE } from '../core/subjectGuide';
import { detectSubjectGuided, type GuidedSubject } from './subjectDetector';

export interface EyeLookup {
  /** The eye, 0 to 1 across the picture given, or null when none stood out. */
  eye: EyeCandidate | null;
  /** Plain words for what happened, for a status line. */
  note: string;
  /** The subject found on the way, so a caller can reuse it. */
  subject: GuidedSubject | null;
}

type Picture = HTMLImageElement | HTMLCanvasElement;
const sizeOf = (picture: Picture) => picture instanceof HTMLImageElement
  ? { w: picture.naturalWidth, h: picture.naturalHeight } : { w: picture.width, h: picture.height };

/**
 * Find the subject's eye in a picture: the subject first (detector-guided, as for masks), then the eye inside it.
 * Only ever used to move a view. `known` reuses a subject already found for this exact picture.
 */
export async function locateEye(picture: Picture, known?: GuidedSubject | null): Promise<EyeLookup> {
  const { w, h } = sizeOf(picture);
  if (!(w > 15 && h > 15)) return { eye: null, note: 'This preview is too small to look for an eye.', subject: null };
  const scale = Math.min(1, GUIDED_RENDER_EDGE / Math.max(w, h));
  const framed = document.createElement('canvas');
  framed.width = Math.max(16, Math.round(w * scale));
  framed.height = Math.max(16, Math.round(h * scale));
  const context = framed.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, 0, 0, framed.width, framed.height);
  const subject = known ?? await detectSubjectGuided(framed);
  // About 1,600 pixels across: enough for a distant bird's eye to be a few pixels wide.
  const sampleScale = Math.min(1, 1600 / Math.max(framed.width, framed.height));
  const sample = document.createElement('canvas');
  sample.width = Math.max(16, Math.round(framed.width * sampleScale));
  sample.height = Math.max(16, Math.round(framed.height * sampleScale));
  const sampleContext = sample.getContext('2d', { willReadFrequently: true });
  if (!sampleContext) throw new Error('Canvas unavailable');
  sampleContext.drawImage(framed, 0, 0, sample.width, sample.height);
  const weights = subject.assessment.usable ? subjectWeights(subject.grid, sample.width, sample.height) : null;
  if (!weights) return { eye: null, note: 'No clear subject, so the view stayed put.', subject };
  const eye = findEye({ luma: lumaOf(sampleContext.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height), subject: weights, width: sample.width, height: sample.height });
  if (!eye) return { eye: null, note: 'No eye stood out clearly, so the view stayed put.', subject };
  return { eye, note: eye.confidence === 'likely' ? 'Zoomed to the eye.' : 'Zoomed to what looks most like the eye. Check it.', subject };
}

// Zoom targets, found ahead of time: the subject (the same off-thread detector masks use) and, inside it, the eye (the
// model-free finder V1 uses). Run in the background as soon as a photo is shown, and for the photos either side of it,
// from the preview the canvas already shows, so 100% and Zoom to eye are instant. Results are kept per photo and preview,
// so nothing is searched twice. Only a view ever moves on these: nothing is judged sharp or in focus.

import { findEye, lumaOf, type EyeCandidate } from '../core/eyeFinder';
import { GUIDED_RENDER_EDGE } from '../core/subjectGuide';
import { cropWeights, padBox, subjectBox, type PictureBox } from '../v2/engineClient/eyeZoom';

export interface ZoomTargets {
  /** The eye, 0 to 1 across the whole picture, or null when none stood out. */
  eye: EyeCandidate | null;
  /** The subject's box, 0 to 1 across the whole picture, or null when the detector found no usable subject. */
  subject: PictureBox | null;
}

type Picture = HTMLImageElement | HTMLCanvasElement;
const sizeOf = (picture: Picture) => picture instanceof HTMLImageElement
  ? { w: picture.naturalWidth, h: picture.naturalHeight } : { w: picture.width, h: picture.height };

/** Find the subject, then look for the eye in a close crop of it at the preview's own resolution. */
export async function findZoomTargets(picture: Picture): Promise<ZoomTargets> {
  const { w, h } = sizeOf(picture);
  if (!(w > 15 && h > 15)) return { eye: null, subject: null };
  const scale = Math.min(1, GUIDED_RENDER_EDGE / Math.max(w, h));
  const framed = document.createElement('canvas');
  framed.width = Math.max(16, Math.round(w * scale));
  framed.height = Math.max(16, Math.round(h * scale));
  const context = framed.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, 0, 0, framed.width, framed.height);
  const { detectSubjectGuided } = await import('./subjectDetector');
  const found = await detectSubjectGuided(framed);
  const subject = found.assessment.usable ? subjectBox(found.grid) : null;
  if (!subject) return { eye: null, subject: null };
  // A small or distant subject is only a few hundred pixels of a whole-frame search, so its eye was a speck the finder
  // could not tell from plumage. Searching a padded crop of the subject, from the full preview, gives it real pixels.
  const region = padBox(subject, 0.12);
  const sourceW = region.width * w;
  const sourceH = region.height * h;
  const cropScale = Math.min(1, 1600 / Math.max(sourceW, sourceH));
  const crop = document.createElement('canvas');
  crop.width = Math.max(16, Math.round(sourceW * cropScale));
  crop.height = Math.max(16, Math.round(sourceH * cropScale));
  const cropContext = crop.getContext('2d', { willReadFrequently: true });
  if (!cropContext) throw new Error('Canvas unavailable');
  cropContext.imageSmoothingQuality = 'high';
  cropContext.drawImage(picture, region.x * w, region.y * h, sourceW, sourceH, 0, 0, crop.width, crop.height);
  const weights = cropWeights(found.grid, region, crop.width, crop.height);
  const luma = lumaOf(cropContext.getImageData(0, 0, crop.width, crop.height).data, crop.width, crop.height);
  const eye = findEye({ luma, subject: weights, width: crop.width, height: crop.height });
  return {
    subject,
    eye: eye ? { ...eye, x: region.x + eye.x * region.width, y: region.y + eye.y * region.height, radius: eye.radius * region.width } : null,
  };
}

const KEEP = 48;
const found = new Map<string, Promise<ZoomTargets | null>>();
/** One search at a time, so a quick flick through photos never competes with what is on screen. */
let queue: Promise<unknown> = Promise.resolve();

function loadPicture(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The preview could not be read.'));
    image.src = url;
  });
}

/** What was found, or will be, for this photo's preview. Null when the search could not run on this device. */
export function zoomTargetsFor(photoId: string, previewUrl: string): Promise<ZoomTargets | null> {
  const key = `${photoId}\u0000${previewUrl}`;
  const known = found.get(key);
  if (known) {
    found.delete(key);
    found.set(key, known);
    return known;
  }
  const search = queue.then(async () => {
    if (!previewUrl) return null;
    const picture = await loadPicture(previewUrl);
    return findZoomTargets(picture);
  }).catch(() => null);
  queue = search;
  found.set(key, search);
  while (found.size > KEEP) found.delete(found.keys().next().value as string);
  // A failed search is not remembered, so it is tried again next time.
  void search.then((result) => { if (result === null && found.get(key) === search) found.delete(key); });
  return search;
}


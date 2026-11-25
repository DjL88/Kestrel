import { DEFAULT_FRAMING, framedSize, type PhotoFraming } from '../core/photoFraming';
import { isRawPreviewFile } from '../core/rawFormats';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { loadImage } from './loadImage';

/** The editor's edited picture is drawn at most this many pixels on its long edge (FrameImage). */
export const EDITED_VIEW_EDGE = 2200;

/**
 * Whether a picture of this size, framed as the photo is framed, still gives the edited view its full long edge. The
 * stored screen develop is at most 2,200 px and can be smaller (it is shrunk to fit the preview cache), and a crop
 * takes pixels away: then it is not enough, and the full develop is used, so the view is never quietly downsampled.
 */
export function screenDevelopEnough(width: number, height: number, framing: PhotoFraming | undefined, edge = EDITED_VIEW_EDGE): boolean {
  if (!(width > 0 && height > 0)) return false;
  const framed = framedSize(width, height, framing ?? DEFAULT_FRAMING);
  return Math.max(framed.width, framed.height) >= edge;
}

export type EditSourceProvider = Pick<BrowserPreviewProvider, 'developedReview' | 'isDeveloped'>;

/**
 * A RAW's picture for the edited view when the full develop is not needed: the screen-size develop stored after import,
 * if it gives the view its full size. Null otherwise (not a RAW, a full develop is already held and is used instead,
 * none stored, or too small for this framing), and the caller uses the full develop as before. Never develops anything
 * itself, so a photo whose stored copy is too small is not developed twice.
 */
export async function storedEditSource(frame: PhotoFrame, provider: EditSourceProvider, decode: (blob: Blob) => Promise<HTMLImageElement> = decodeBlob): Promise<HTMLImageElement | null> {
  if (frame.isDemo || !isRawPreviewFile(frame.filename) || provider.isDeveloped(frame.stableKey)) return null;
  const review = (await provider.developedReview(frame).catch(() => null))?.review;
  if (!review) return null;
  const picture = await decode(review).catch(() => null);
  return picture && screenDevelopEnough(picture.naturalWidth, picture.naturalHeight, frame.framing) ? picture : null;
}

// The editor asks for its source again after every slider pause: the last few stored pictures stay decoded, and their
// addresses are let go only when they leave this list.
const decoded: { blob: Blob; url: string; image: Promise<HTMLImageElement> }[] = [];
const DECODED_LIMIT = 4;

function decodeBlob(blob: Blob): Promise<HTMLImageElement> {
  const known = decoded.findIndex((entry) => entry.blob === blob);
  if (known >= 0) {
    const [entry] = decoded.splice(known, 1);
    decoded.push(entry);
    return entry.image;
  }
  const url = URL.createObjectURL(blob);
  const image = loadImage(url);
  const entry = { blob, url, image };
  decoded.push(entry);
  image.catch(() => {
    const at = decoded.indexOf(entry);
    if (at >= 0) decoded.splice(at, 1);
    URL.revokeObjectURL(url);
  });
  while (decoded.length > DECODED_LIMIT) URL.revokeObjectURL(decoded.shift()!.url);
  return image;
}

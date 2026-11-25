import { extractRawPreview } from '../core/nefPreview';
import { isRawPreviewFile } from '../core/rawFormats';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from './browserPreviewProvider';
import { canDevelopRaw, developRaw, matchPreviewOrientation } from './rawDevelop';

/** What an analysis needs from the provider: the stored develop, and the original to make one. */
export type AnalysisProvider = Pick<BrowserPreviewProvider, 'developedReview' | 'ensureOriginal' | 'storeDevelopedPicture'>;

/** The steps that make and store a screen-size develop; replaced in tests. */
export interface ScreenDevelop {
  develop: (original: Blob, extension: string) => Promise<Blob>;
  orient: (developed: Blob, original: Blob) => Promise<Blob>;
  decode: (blob: Blob) => Promise<HTMLImageElement | null>;
}

const realDevelop: ScreenDevelop = {
  develop: (original, extension) => developRaw(original, extension, { size: 'screen' }),
  orient: async (developed, original) => matchPreviewOrientation(developed, await extractRawPreview(original).catch(() => null)),
  decode: decodePicture,
};

const pending = new Map<string, Promise<boolean>>();

/**
 * A RAW's picture for analysis that needs no more than a screen's worth of pixels (Co-pilot's check, colour and white
 * balance measurements): the screen-size develop stored after import (at most 2,200 px, developed from the sensor data),
 * or, when none is stored yet, a screen-size develop made now and stored for next time. Never a full 45 MP develop,
 * which took about 25 s per Nikon Z 8 photo just to be shrunk again; never the camera's embedded JPEG.
 *
 * Null when the RAW cannot be developed on this device or its original is not reachable. Anything that writes pixels
 * at full size (exports, layers copied at full size) must keep using the full develop instead.
 */
export async function loadAnalysisPicture(frame: PhotoFrame, provider: AnalysisProvider, signal?: AbortSignal, steps: ScreenDevelop = realDevelop): Promise<HTMLImageElement | null> {
  if (frame.isDemo || !isRawPreviewFile(frame.filename)) return null;
  const kept = await provider.developedReview(frame).catch(() => null);
  if (kept?.review) return steps.decode(kept.review);
  signal?.throwIfAborted();
  if (steps === realDevelop && !canDevelopRaw()) return null;
  // One screen develop per photo at a time, however many analyses ask for it.
  const key = `${frame.stableKey}|${frame.originalSha256 ?? ''}`;
  let made = pending.get(key);
  if (!made) {
    made = (async () => {
      const original = await provider.ensureOriginal(frame.stableKey, 'selected');
      if (!original) return false;
      const extension = /\.([a-z0-9]+)$/i.exec(frame.filename)?.[1] ?? 'nef';
      const turned = await steps.orient(await steps.develop(original, extension), original);
      return provider.storeDevelopedPicture(frame, original, turned);
    })().finally(() => pending.delete(key));
    pending.set(key, made);
  }
  const stored = await made;
  signal?.throwIfAborted();
  const review = stored ? (await provider.developedReview(frame).catch(() => null))?.review : null;
  return review ? steps.decode(review) : null;
}

/** The stored develop as a loaded picture. Its URL is let go once loaded; a loaded picture keeps its pixels. */
async function decodePicture(blob: Blob): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

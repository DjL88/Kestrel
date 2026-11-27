/// <reference lib="webworker" />
import { renderTurned16 } from '../core/master16';
import { ditherRgb16ToRgba8 } from '../core/rgb16Output';
import type { PhotoEdit } from '../core/photoEdits';
import type { PhotoFraming } from '../core/photoFraming';

type Request = { id: number; picture: number; width: number; height: number; data?: ArrayBuffer; turn: number; edit: PhotoEdit; framing?: PhotoFraming };

/** The few 16-bit copies sent here, kept so each edit sends only the edit (a 45 MP photo's copy is about 30 MB). */
const KEEP = 3;
const pictures = new Map<number, { width: number; height: number; data: Uint16Array }>();

/** Draws the kept 16-bit copy with an edit off the main thread, so sliders stay responsive while it works. */
self.onmessage = (event: MessageEvent<Request>) => {
  const { id, picture, width, height, data, turn, edit, framing } = event.data;
  try {
    if (data) {
      pictures.delete(picture);
      pictures.set(picture, { width, height, data: new Uint16Array(data) });
      while (pictures.size > KEEP) pictures.delete(pictures.keys().next().value as number);
    }
    const kept = pictures.get(picture);
    if (!kept) {
      self.postMessage({ id, missing: true });
      return;
    }
    // renderTurned16 works on its own copy, so the kept picture is never changed by an edit.
    const rendered = renderTurned16(kept, turn, edit, framing);
    if (!rendered) {
      self.postMessage({ id, none: true });
      return;
    }
    // One rounding to the screen, with the same fixed position-based dither as the export, so a strong lift of a smooth
    // sky shows no steps (plain rounding leaves 1-level bands that a lift has spread wide).
    const rgba = ditherRgb16ToRgba8(rendered);
    self.postMessage({ id, width: rendered.width, height: rendered.height, rgba: rgba.buffer }, [rgba.buffer]);
  } catch {
    self.postMessage({ id, none: true });
  }
};

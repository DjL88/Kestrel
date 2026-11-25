/// <reference lib="webworker" />
import { renderTurned16 } from '../core/master16';
import { ditherRgb16ToRgba8 } from '../core/rgb16Output';
import type { PhotoEdit } from '../core/photoEdits';
import type { PhotoFraming } from '../core/photoFraming';

/** Draws the kept 16-bit copy with an edit off the main thread, so sliders stay responsive while it works. */
self.onmessage = (event: MessageEvent<{ id: number; width: number; height: number; data: ArrayBuffer; turn: number; edit: PhotoEdit; framing?: PhotoFraming }>) => {
  const { id, width, height, data, turn, edit, framing } = event.data;
  try {
    const rendered = renderTurned16({ width, height, data: new Uint16Array(data) }, turn, edit, framing);
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

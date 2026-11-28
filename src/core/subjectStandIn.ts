/**
 * TEST DOUBLE, NOT A MODEL. A deterministic stand-in for the subject mask network, used only by the browser tests, which
 * build with VITE_SUBJECT_MASK_STAND_IN=true (playwright.config.ts). The real network (U2-Netp) is RED under the model
 * licence policy of 28 Nov 2026 and is not in the repository, so the tests cannot load it.
 *
 * It returns a soft 0..1 map that is high where a picture differs from its own border (the background estimate) and low
 * elsewhere. For a test picture with a clearly different subject on a plainer background that is a plausible subject
 * mask; for anything else it is not, and it is never a statement about mask QUALITY. Installers refuse to build with the
 * flag set (scripts/build-desktop-guard.mjs).
 */

/** Whether this build was made with the stand-in switched on. A literal comparison so a normal build drops the code. */
export const SUBJECT_MASK_STAND_IN = import.meta.env?.VITE_SUBJECT_MASK_STAND_IN === 'true';

const smoothstep = (low: number, high: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** A size by size soft subject map from a size by size RGBA picture. Deterministic: the same pixels give the same map. */
export function standInSubjectMap(rgba: Uint8ClampedArray, size: number): Float32Array {
  const plane = size * size;
  const edge = Math.max(2, Math.round(size * 0.06));
  const background = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x >= edge && x < size - edge && y >= edge && y < size - edge) continue;
      const i = (y * size + x) * 4;
      background[0] += rgba[i]; background[1] += rgba[i + 1]; background[2] += rgba[i + 2];
      count += 1;
    }
  }
  for (let c = 0; c < 3; c += 1) background[c] /= count || 1;
  const raw = new Float32Array(plane);
  for (let i = 0; i < plane; i += 1) {
    const distance = Math.hypot(rgba[i * 4] - background[0], rgba[i * 4 + 1] - background[1], rgba[i * 4 + 2] - background[2]) / 441;
    raw[i] = smoothstep(0.08, 0.3, distance);
  }
  // A small box blur makes the edge soft, as the real map's edge is, and drops single-pixel speckle.
  const out = new Float32Array(plane);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const yy = y + dy; const xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= size || xx >= size) continue;
          sum += raw[yy * size + xx]; n += 1;
        }
      }
      out[y * size + x] = sum / n;
    }
  }
  return out;
}

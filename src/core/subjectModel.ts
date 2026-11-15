import type { SubjectGrid } from './maskTypes';

/**
 * The bundled subject model. U²-Net-P is a small salient-object network by Qin et al. (Apache-2.0,
 * github.com/xuebinqin/U-2-Net), converted to ONNX by the rembg project (MIT). The checksum was taken from the
 * file in this repository. It finds the most prominent object. It is not trained on wildlife specifically,
 * so results must be checked, and the user can refine them.
 */
export const SUBJECT_MODEL = {
  name: 'U²-Net-P',
  file: 'u2netp.onnx',
  bytes: 4574861,
  sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  licence: 'Apache-2.0',
  inputSize: 320,
} as const;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Turn a 320 by 320 RGBA picture into the model's planar, normalised input. */
export function preprocess(rgba: Uint8ClampedArray, size = SUBJECT_MODEL.inputSize): Float32Array {
  const plane = size * size;
  const out = new Float32Array(plane * 3);
  // Match the reference pipeline: scale by the brightest value, then normalise.
  let peak = 1;
  for (let i = 0; i < plane; i += 1) peak = Math.max(peak, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  for (let i = 0; i < plane; i += 1) {
    for (let channel = 0; channel < 3; channel += 1) out[channel * plane + i] = (rgba[i * 4 + channel] / peak - MEAN[channel]) / STD[channel];
  }
  return out;
}

/** The network's first output is an unscaled probability map. Stretch it to 0..1 so faint maps stay usable. */
export function normaliseMap(output: Float32Array): Float32Array {
  let low = Infinity;
  let high = -Infinity;
  for (const value of output) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const span = high - low;
  if (!(span > 1e-6)) return new Float32Array(output.length);
  return Float32Array.from(output, (value) => (value - low) / span);
}

export interface SubjectAssessment {
  /** Share of the picture the map calls subject. */
  coverage: number;
  /** Share of cells that are clearly subject or clearly background. */
  decisive: number;
  confidence: 'high' | 'medium' | 'low';
  /** False when nothing stands out, or almost everything does, so the app should say so instead of guessing. */
  usable: boolean;
  reason: string;
}

/** `maxCoverage` is how much of the picture may be subject. Looking inside a chosen area allows more, since the area is already tight. */
export function assessSubject(map: Float32Array, maxCoverage = 0.92): SubjectAssessment {
  let subject = 0;
  let decisive = 0;
  for (const value of map) {
    if (value > 0.5) subject += 1;
    if (value < 0.15 || value > 0.85) decisive += 1;
  }
  const coverage = subject / Math.max(1, map.length);
  const share = decisive / Math.max(1, map.length);
  if (coverage < 0.01) return { coverage, decisive: share, confidence: 'low', usable: false, reason: 'No clear subject found.' };
  if (coverage > maxCoverage) return { coverage, decisive: share, confidence: 'low', usable: false, reason: 'Nearly the whole photo looks like the subject, so there is nothing to separate.' };
  const confidence = share > 0.9 ? 'high' : share > 0.8 ? 'medium' : 'low';
  return { coverage, decisive: share, confidence, usable: true,
    reason: confidence === 'low' ? 'The edges are uncertain. Check the mask and refine it with the brush.' : confidence === 'medium' ? 'Check the edges, especially around fine detail.' : 'The subject stands out clearly.' };
}

/** Resample the model map to a compact grid and encode it for the recipe. */
export function toGrid(map: Float32Array, size: number, w: number, h: number): SubjectGrid {
  const bytes = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const fy = Math.min(size - 1.001, Math.max(0, ((y + 0.5) / h) * size - 0.5));
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x += 1) {
      const fx = Math.min(size - 1.001, Math.max(0, ((x + 0.5) / w) * size - 0.5));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const v = (map[y0 * size + x0] * (1 - tx) + map[y0 * size + x0 + 1] * tx) * (1 - ty) +
        (map[(y0 + 1) * size + x0] * (1 - tx) + map[(y0 + 1) * size + x0 + 1] * tx) * ty;
      bytes[y * w + x] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return { w, h, data: btoa(binary) };
}

/** Grid size for a photo of this shape, about 192 cells across the long side. */
export function gridSizeFor(aspect: number): { w: number; h: number } {
  const long = 192;
  return aspect >= 1 ? { w: Math.max(8, Math.round(long / aspect)), h: long } : { w: long, h: Math.max(8, Math.round(long * aspect)) };
}

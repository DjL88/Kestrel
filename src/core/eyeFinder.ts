/**
 * Finds a likely eye inside a subject, without a model, so the viewer can zoom straight to it.
 *
 * No open eye model can be shipped yet (the bird keypoint data sets and pose weights we found are research-only), so
 * this is plain image analysis: an eye is a small, round, dark spot, clearly darker than the ring around it, usually
 * with a bright catchlight, inside the subject. It is used only to move the view. It never claims an eye is sharp or
 * in focus, and it abstains when the darkest spot is not clearly the only one (a magpie's or starling's plumage).
 */

export interface EyeCandidate {
  /** Centre, 0 to 1 across the picture analysed. */
  x: number;
  y: number;
  /** Radius as a share of the picture's width. */
  radius: number;
  /** 'likely' only when the spot is distinct, round-ish and well inside the subject. */
  confidence: 'likely' | 'possible';
}

export interface EyeSearchInput {
  /** Luminance 0 to 1, row by row. */
  luma: Float32Array;
  /** Subject weight 0 to 1 per pixel (same size), or null to search everywhere. */
  subject: Float32Array | null;
  width: number;
  height: number;
}

/** Luminance (Rec. 709 weights on the stored values) of RGBA pixels. */
export function lumaOf(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  }
  return out;
}

/** Summed-area table with a zero first row and column, for constant-time box means. */
function integral(values: Float32Array, width: number, height: number): Float64Array {
  const table = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += values[y * width + x];
      table[(y + 1) * (width + 1) + x + 1] = table[y * (width + 1) + x + 1] + row;
    }
  }
  return table;
}

function boxSum(table: Float64Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  const w = width + 1;
  return table[y1 * w + x1] - table[y0 * w + x1] - table[y1 * w + x0] + table[y0 * w + x0];
}

interface Scored { x: number; y: number; r: number; score: number; contrast: number; catchlight: boolean; inside: number }

/** Smallest dark-centre contrast (ring mean minus centre mean, on 0 to 1 luminance) worth calling an eye. */
export const EYE_MIN_CONTRAST = 0.12;
/** A second spot this close in score, somewhere else, makes the answer ambiguous. */
export const EYE_AMBIGUITY = 0.88;

/**
 * The most likely eye, or null when nothing stands out clearly enough. Sizes are searched relative to the subject's
 * extent, so the same rules work for a frame-filling portrait and a distant bird.
 */
export function findEye(input: EyeSearchInput): EyeCandidate | null {
  const { luma, subject, width, height } = input;
  if (width < 16 || height < 16 || luma.length !== width * height) return null;
  if (subject && subject.length !== width * height) return null;
  if (!luma.every(Number.isFinite)) return null;

  // The subject's extent sets the eye sizes to try.
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (subject && !(subject[y * width + x] >= 0.5)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  const extent = Math.hypot(x1 - x0 + 1, y1 - y0 + 1);
  const radii = [0.01, 0.015, 0.022, 0.032, 0.045].map((share) => share * extent).filter((r) => r >= 1.5);
  if (!radii.length) return null;

  const lumaTable = integral(luma, width, height);
  const squared = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i += 1) squared[i] = luma[i] * luma[i];
  const squaredTable = integral(squared, width, height);
  const subjectTable = subject ? integral(subject, width, height) : null;

  const found: Scored[] = [];
  for (const r of radii) {
    const inner = Math.max(1, Math.round(r));
    const ringIn = Math.max(inner + 1, Math.round(r * 1.5));
    const ringOut = Math.max(ringIn + 1, Math.round(r * 2.4));
    const step = Math.max(1, Math.floor(inner / 2));
    for (let cy = y0 + ringOut; cy <= y1 - ringOut; cy += step) {
      for (let cx = x0 + ringOut; cx <= x1 - ringOut; cx += step) {
        const ix0 = cx - inner, iy0 = cy - inner, ix1 = cx + inner + 1, iy1 = cy + inner + 1;
        const innerArea = (ix1 - ix0) * (iy1 - iy0);
        // The whole ring must be on the subject, so a dark gap between legs or a twig against the sky doesn't count.
        const ox0 = cx - ringOut, oy0 = cy - ringOut, ox1 = cx + ringOut + 1, oy1 = cy + ringOut + 1;
        const outerArea = (ox1 - ox0) * (oy1 - oy0);
        const inside = subjectTable ? boxSum(subjectTable, width, ox0, oy0, ox1, oy1) / outerArea : 1;
        if (inside < 0.85) continue;
        const innerMean = boxSum(lumaTable, width, ix0, iy0, ix1, iy1) / innerArea;
        const mx0 = cx - ringIn, my0 = cy - ringIn, mx1 = cx + ringIn + 1, my1 = cy + ringIn + 1;
        const middleArea = (mx1 - mx0) * (my1 - my0);
        const ringSum = boxSum(lumaTable, width, ox0, oy0, ox1, oy1) - boxSum(lumaTable, width, mx0, my0, mx1, my1);
        const ringArea = outerArea - middleArea;
        const ringMean = ringSum / ringArea;
        const ringSquares = boxSum(squaredTable, width, ox0, oy0, ox1, oy1) - boxSum(squaredTable, width, mx0, my0, mx1, my1);
        const ringDeviation = Math.sqrt(Math.max(0, ringSquares / ringArea - ringMean * ringMean));
        const contrast = ringMean - innerMean;
        if (contrast < EYE_MIN_CONTRAST) continue;
        // A catchlight: some pixel in the dark centre is much brighter than the centre's mean.
        let brightest = 0;
        for (let y = iy0; y < iy1; y += 1) for (let x = ix0; x < ix1; x += 1) brightest = Math.max(brightest, luma[y * width + x]);
        const catchlight = brightest - innerMean > 0.3;
        // Contrast against how busy the surroundings are: an eye on smooth feathers beats a gap in barred plumage.
        const score = (contrast / (0.04 + ringDeviation)) * (catchlight ? 1.25 : 1);
        found.push({ x: cx, y: cy, r: inner, score, contrast, catchlight, inside });
      }
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score);
  const best = found[0];
  // Another spot, clearly elsewhere, nearly as eye-like: refuse to choose between them.
  const rival = found.find((other) => Math.hypot(other.x - best.x, other.y - best.y) > 4 * Math.max(best.r, other.r));
  if (rival && rival.score >= best.score * EYE_AMBIGUITY) return null;
  const distinct = !rival || rival.score < best.score * 0.6;
  return {
    x: (best.x + 0.5) / width,
    y: (best.y + 0.5) / height,
    radius: best.r / width,
    confidence: distinct && best.contrast >= 0.2 && best.inside >= 0.95 ? 'likely' : 'possible',
  };
}

/** Pan that puts a point (0 to 1 across the fitted photo) in the middle of the view at this zoom. */
export function panToCentre(point: { x: number; y: number }, fitted: { width: number; height: number }, zoom: number) {
  return { x: -(point.x - 0.5) * fitted.width * zoom, y: -(point.y - 0.5) * fitted.height * zoom };
}

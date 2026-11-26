import { calibrationMatrix, type Calibration } from './calibration';
import { srgbToLab } from './iccProfile';

/**
 * Calibrate a camera from a photo of a 24-patch colour checker (the classic 4 × 6 chart). The photographer marks the
 * centres of the four corner patches; each patch is averaged; white balance and exposure are taken from the grey row;
 * then the camera calibration sliders (hue and saturation of each primary) are fitted so the 18 colour patches land as
 * close as they can to the chart's published values. The fit only uses the existing, reversible Calibration controls.
 */

/** Published sRGB values of the 24-patch chart, row by row from dark skin (top left) to black (bottom right). */
export const CHECKER_SRGB: ReadonlyArray<readonly [number, number, number]> = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
];

export interface Point { x: number; y: number }
/** Centres of the corner patches, in picture pixels: dark skin, bluish green, black, white. */
export type CheckerCorners = [topLeft: Point, topRight: Point, bottomRight: Point, bottomLeft: Point];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
const linearOf = (rgb: readonly number[]) => rgb.map((v) => toLinear(v / 255));

/** Where each patch's centre is, by bilinear interpolation between the four marked corners. */
export function patchCentres(corners: CheckerCorners): Point[] {
  const [tl, tr, br, bl] = corners;
  const out: Point[] = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) {
    const u = col / 5, v = row / 3;
    out.push({
      x: (1 - v) * ((1 - u) * tl.x + u * tr.x) + v * ((1 - u) * bl.x + u * br.x),
      y: (1 - v) * ((1 - u) * tl.y + u * tr.y) + v * ((1 - u) * bl.y + u * br.y),
    });
  }
  return out;
}

/** Average the middle of each patch (a square a third of the patch spacing), as linear sRGB. */
export function samplePatches(pixels: { data: ArrayLike<number>; width: number; height: number }, corners: CheckerCorners): number[][] {
  const centres = patchCentres(corners);
  const spacing = Math.min(Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) / 5,
    Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y) / 3);
  const half = Math.max(1, Math.round(spacing / 6));
  return centres.map(({ x, y }) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue;
      const i = (py * pixels.width + px) * 4;
      sum[0] += pixels.data[i]; sum[1] += pixels.data[i + 1]; sum[2] += pixels.data[i + 2];
      n++;
    }
    if (!n) throw new RangeError('A patch is outside the picture. Move the corner marks onto the chart.');
    return linearOf(sum.map((v) => v / n));
  });
}

const NEUTRALS = [19, 20, 21, 22];
const COLOURS = Array.from({ length: 18 }, (_, i) => i);

function meanError(measured: readonly number[][], matrix: ArrayLike<number> | null): number {
  let total = 0;
  for (const i of COLOURS) {
    const m = measured[i];
    const c = matrix ? [0, 1, 2].map((r) => matrix[r * 3] * m[0] + matrix[r * 3 + 1] * m[1] + matrix[r * 3 + 2] * m[2]) : m;
    const lab = srgbToLab(c.map((v) => toGamma(Math.min(1, Math.max(0, v)))));
    const ref = srgbToLab(CHECKER_SRGB[i].map((v) => v / 255));
    total += Math.hypot(lab[0] - ref[0], lab[1] - ref[1], lab[2] - ref[2]);
  }
  return total / COLOURS.length;
}

export interface CheckerFit {
  calibration: Calibration;
  /** Mean colour error (ΔE 1976) of the 18 colour patches, after white balance from the grey row, before and after. */
  before: number;
  after: number;
}

/**
 * Fit the six calibration sliders. The grey patches set white balance and exposure for the fit only; the photo's own
 * white balance is not changed. Refuses a chart whose grey row isn't grey enough to trust (the marks are probably off).
 */
export function fitCheckerCalibration(samples: readonly number[][]): CheckerFit {
  if (samples.length !== 24) throw new RangeError('A colour checker has 24 patches.');
  const reference = CHECKER_SRGB.map(linearOf);
  const gains = [0, 1, 2].map((c) => NEUTRALS.reduce((s, i) => s + reference[i][c], 0) / Math.max(1e-6, NEUTRALS.reduce((s, i) => s + samples[i][c], 0)));
  const measured = samples.map((rgb) => rgb.map((v, c) => v * gains[c]));
  // The grey row must step down from light to dark, or the marks are not on the chart the right way round.
  const luma = (rgb: readonly number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  for (let i = 18; i < 23; i++) {
    if (!(luma(measured[i]) > luma(measured[i + 1]))) throw new RangeError('The bottom row doesn’t step from white to black. Check the corner marks are on the right patches.');
  }
  const params = [0, 0, 0, 0, 0, 0];
  const toCalibration = (p: readonly number[]): Calibration => ({ red: [p[0], p[1]], green: [p[2], p[3]], blue: [p[4], p[5]] });
  const cost = (p: readonly number[]) => meanError(measured, calibrationMatrix(toCalibration(p)));
  let best = cost(params);
  for (let step = 0.25; step >= 0.004; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let k = 0; k < 6; k++) for (const sign of [1, -1]) {
        const trial = [...params];
        trial[k] = Math.min(1, Math.max(-1, trial[k] + sign * step));
        const value = cost(trial);
        if (value < best - 1e-6) { best = value; params.splice(0, 6, ...trial); improved = true; }
      }
    }
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return { calibration: toCalibration(params.map(round)), before: meanError(measured, null), after: best };
}

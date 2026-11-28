import type { PreviewFrame, VisionAssistant, VisionCritique } from '../../src/core/enhanceLoop';
import type { AiReviewIssue } from '../../src/core/aiReview';
import { lightness } from '../../src/core/enhanceObserve';
import { toOklab } from '../../src/core/colourCheck';

/**
 * STAND-IN, NOT THE REAL MODEL. A real on-device vision model (SmolVLM2 and friends) cannot run headless in this harness:
 * the weights are not in the repository and the runtime is the desktop app's. So the harness uses this deterministic
 * critic, built from DIFFERENT measures than the loop's own gates (whole-frame mean lightness, grey-world colour balance,
 * Hasler-Suesstrunk colourfulness, RMS contrast, Laplacian energy), as a second pair of eyes. It makes no scene claims
 * (no species, no subject names): `observe` returns nothing, so the vision-observation path is NOT exercised here.
 * Every report that uses it says "stand-in", never "the vision AI".
 */
interface Aesthetic { meanL: number; rms: number; castAB: number; colourful: number; lap: number }

function aesthetic(f: PreviewFrame): Aesthetic {
  const n = f.width * f.height, stride = Math.max(1, Math.floor(n / 80000));
  let sum = 0, sum2 = 0, c = 0, sa = 0, sb = 0, rg = 0, rg2 = 0, yb = 0, yb2 = 0;
  for (let i = 0; i < n; i += stride) {
    const r = f.rgba[i * 4], g = f.rgba[i * 4 + 1], b = f.rgba[i * 4 + 2];
    const l = lightness(r, g, b); sum += l; sum2 += l * l; c += 1;
    const o = toOklab(r, g, b); sa += o[1]; sb += o[2];
    const d1 = r - g, d2 = 0.5 * (r + g) - b; rg += d1; rg2 += d1 * d1; yb += d2; yb2 += d2 * d2;
  }
  const meanL = sum / c, rms = Math.sqrt(Math.max(0, sum2 / c - meanL * meanL));
  const sdRG = Math.sqrt(Math.max(0, rg2 / c - (rg / c) ** 2)), sdYB = Math.sqrt(Math.max(0, yb2 / c - (yb / c) ** 2));
  const colourful = Math.hypot(sdRG, sdYB) + 0.3 * Math.hypot(rg / c, yb / c);
  let lap = 0, lc = 0;
  for (let y = 1; y < f.height - 1; y += 3) for (let x = 1; x < f.width - 1; x += 3) {
    const p = y * f.width + x;
    const at = (q: number) => f.rgba[q * 4 + 1];
    lap += Math.abs(4 * at(p) - at(p - 1) - at(p + 1) - at(p - f.width) - at(p + f.width)); lc += 1;
  }
  return { meanL, rms, castAB: Math.hypot(sa / c, sb / c), colourful, lap: lc ? lap / lc : 0 };
}

function standInCritique(before: PreviewFrame, after: PreviewFrame): VisionCritique {
  const a = aesthetic(before), b = aesthetic(after);
  const issues: AiReviewIssue[] = [];
  if (b.meanL < 0.28 && a.meanL >= 0.0) issues.push('tooDark');
  if (b.meanL > 0.78) issues.push('tooBright');
  if (b.castAB > 0.05 && b.castAB > a.castAB * 0.8) issues.push('cast');
  if (b.rms < 0.12) issues.push('flat');
  if (a.colourful > 1 && b.colourful / a.colourful > 1.4) issues.push('tooStrong');
  if (a.lap > 0.5 && b.lap / a.lap > 1.7) issues.push('tooStrong');
  return { issues, summary: issues.length ? 'The stand-in critic still sees: ' + issues.join(', ') : 'The stand-in critic sees nothing wrong' };
}

function score(before: PreviewFrame, f: PreviewFrame): number {
  const a = aesthetic(before), b = aesthetic(f);
  const over = Math.max(0, b.colourful / Math.max(a.colourful, 1) - 1.25) + Math.max(0, b.lap / Math.max(a.lap, 0.5) - 1.5);
  return -Math.abs(b.meanL - 0.46) * 1.5 - b.castAB * 2 + 0.6 * Math.min(1, b.rms / 0.2) - over;
}

export const standInVision: VisionAssistant = {
  kind: 'stand-in',
  observe: async () => [],
  critique: async (before, after) => standInCritique(before, after),
  prefer: async (before, candidates) => {
    if (!candidates.length) return null;
    let best = 0, bestScore = -Infinity;
    candidates.forEach((c, i) => { const s = score(before, c); if (s > bestScore) { bestScore = s; best = i; } });
    return best;
  },
};

export { aesthetic };

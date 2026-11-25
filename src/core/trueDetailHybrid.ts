import type { Pixels } from './colourCheck';

/**
 * TrueDetail's regional guardian (owner decision 8, 25 Nov 2026). TrueDetail is a combination: each candidate
 * denoise is judged per region (background, subject, eyes) against the ORIGINAL, and a region only takes a candidate
 * that measurably removes noise there without losing real structure or adding texture the original did not have.
 * When no candidate passes, the region keeps the original. Nothing is invented: these are deterministic measurements on
 * the working copy, not a trained model, and the thresholds are a first cut, not calibrated on real high-ISO shoots.
 *
 * Candidates are any denoised rendering of the same framing. Today the app feeds the conventional colour and grain
 * noise reduction at a ladder of strengths; a learned denoiser's output (NAFNet, the trained TrueDetail network) is
 * judged by the same rules once it can be stored as a reversible recipe.
 */
export type DenoiseRegion = 'background' | 'subject' | 'eyes';

export interface RegionPolicy {
  /** Strengths to try, strongest first (same 0 to 2 range as `PhotoEdit.denoise`), as a share of the requested one. */
  ladder: readonly number[];
  /** Coherent edge contrast the region must keep overall, 0 to 1. */
  minDetail: number;
  /** ...and in its worst 32 px block, so one damaged feather patch can't hide in an average. */
  minWorst: number;
}

/** Background strongest, subject gentler, eyes gentlest and strictest. */
export const TRUEDETAIL_REGIONS: Readonly<Record<DenoiseRegion, RegionPolicy>> = {
  background: { ladder: [2, 1.5, 1, 0.6, 0.3], minDetail: 0.6, minWorst: 0.45 },
  subject: { ladder: [0.8, 0.6, 0.4, 0.25, 0.1], minDetail: 0.85, minWorst: 0.7 },
  eyes: { ladder: [0.25, 0.1], minDetail: 0.95, minWorst: 0.9 },
};

/** A region must lose at least this share of its measured noise for a candidate to count as an improvement. */
export const MIN_NOISE_DROP = 0.05;
/** More fine-scale energy than the original in flat areas, by this share, reads as added texture: rejected. */
export const MAX_ADDED_TEXTURE = 0.03;

export interface RegionScore {
  /** Pixels (weight sum) the region covers in the working copy. */
  coverage: number;
  /** Median absolute fine-scale deviation in flat areas, before and after, 0 to 255 scale. */
  noiseBefore: number;
  noiseAfter: number;
  /** Coherent edge contrast kept, overall and in the worst block, 0 to 1 (1 when there are no edges to judge). */
  detail: number;
  worstBlock: number;
  /** Change in fine-scale energy in flat areas; above zero means texture was added. */
  addedTexture: number;
}

export interface CandidateVerdict {
  /** 'conventional', or the learned denoiser's id (e.g. 'nafnet-sidd-w32-w16'). */
  source: string;
  strength: number; ok: boolean; reason: string | null; score: RegionScore;
}

/** A learned denoiser's result at one blend strength, offered to some regions. */
export interface LearnedCandidate { source: string; strength: number; regions: readonly DenoiseRegion[]; render: () => Promise<Pixels> }

const noiseDrop = (v: CandidateVerdict) => v.score.noiseBefore > 0 ? 1 - v.score.noiseAfter / v.score.noiseBefore : 0;

/** Among passing candidates, the one that removes the most noise; on a tie, the one that keeps more structure. */
export function bestVerdict(verdicts: readonly CandidateVerdict[]): CandidateVerdict | undefined {
  let best: CandidateVerdict | undefined;
  for (const v of verdicts) {
    if (!v.ok) continue;
    if (!best || noiseDrop(v) > noiseDrop(best) + 1e-6 || (Math.abs(noiseDrop(v) - noiseDrop(best)) <= 1e-6 && v.score.detail > best.score.detail)) best = v;
  }
  return best;
}

export interface RegionChoice {
  region: DenoiseRegion;
  /** Which denoiser won: 'conventional' or a learned denoiser's id. */
  source: string;
  /** The chosen strength (blend strength for a learned one), or 0 when no candidate improved on the original. */
  strength: number;
  verdicts: CandidateVerdict[];
  /** Plain-English reason the original was kept, or null when a candidate was chosen. */
  kept: string | null;
}

const lumaAt = (data: Uint8ClampedArray, p: number) => 0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];

function lumaPlane(pixels: Pixels): Float32Array {
  const out = new Float32Array(pixels.width * pixels.height);
  for (let p = 0; p < out.length; p++) out[p] = lumaAt(pixels.data, p);
  return out;
}

/** Fine-scale deviation: the pixel against the mean of its 4 neighbours. Grain lives here; edges are excluded by `flat`. */
function deviation(luma: Float32Array, width: number, p: number): number {
  return Math.abs(luma[p] - (luma[p - 1] + luma[p + 1] + luma[p - width] + luma[p + width]) / 4);
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
};

/**
 * Coherent structure versus noise: compare differences at distance 1 and 3, as `regionalDetailGuard.ts` does. A
 * region's flat pixels are where the original's 5-pixel span changes less than a feather edge would.
 */
export function scoreRegion(original: Pixels, candidate: Pixels, weight: Float32Array, beforeLuma = lumaPlane(original)): RegionScore {
  const { width, height } = original;
  if (candidate.width !== width || candidate.height !== height || weight.length !== width * height) throw new RangeError('Candidate and region must match the original');
  const after = lumaPlane(candidate);
  let coverage = 0;
  const before: number[] = [], next: number[] = [];
  let energyBefore = 0, energyAfter = 0;
  for (let y = 2; y < height - 2; y += 1) for (let x = 2; x < width - 2; x += 1) {
    const p = y * width + x;
    if (!(weight[p] >= 0.5)) continue;
    coverage += 1;
    // Flat: no coherent step across five pixels in either direction.
    const span = Math.max(Math.abs(beforeLuma[p - 2] - beforeLuma[p + 2]), Math.abs(beforeLuma[p - 2 * width] - beforeLuma[p + 2 * width]));
    if (span > 24) continue;
    const d0 = deviation(beforeLuma, width, p), d1 = deviation(after, width, p);
    before.push(d0); next.push(d1);
    energyBefore += d0 * d0; energyAfter += d1 * d1;
  }
  // Structure kept, per 32 px block. A step counts as structure only above the noise floor: three times the noise's
  // standard deviation (the median deviation from four neighbours is about 0.75 sigma for Gaussian noise), so a perfect
  // denoiser is not mistaken for one that lost detail just because the noise itself made steps.
  const sigma = median(before.slice()) / 0.754;
  const floor = Math.max(8, 3 * sigma);
  const block = 32;
  let baseline = 0, retained = 0, worstBlock = 1;
  for (let by = 0; by < height; by += block) for (let bx = 0; bx < width; bx += block) {
    let old = 0, kept = 0, edges = 0;
    for (let y = by; y < Math.min(height, by + block); y += 1) for (let x = bx; x < Math.min(width, bx + block); x += 1) {
      const p = y * width + x;
      if (!(weight[p] >= 0.5)) continue;
      for (const distance of [1, 3]) for (const q of [x + distance < width ? p + distance : -1, y + distance < height ? p + distance * width : -1]) {
        if (q < 0 || !(weight[q] >= 0.5)) continue;
        const a = Math.abs(beforeLuma[p] - beforeLuma[q]);
        if (a < floor) continue;
        old += a; kept += Math.min(a, Math.abs(after[p] - after[q])); edges += 1;
      }
    }
    if (edges < 4 || old < 48) continue;
    baseline += old; retained += kept;
    worstBlock = Math.min(worstBlock, kept / old);
  }
  return {
    coverage,
    noiseBefore: median(before), noiseAfter: median(next),
    detail: baseline ? retained / baseline : 1, worstBlock,
    addedTexture: energyBefore > 0 ? energyAfter / energyBefore - 1 : 0,
  };
}

/** Too small to judge reliably: the original is kept rather than guessed at. */
export const MIN_REGION_PIXELS = 256;

export function judgeRegion(score: RegionScore, policy: RegionPolicy): string | null {
  if (score.coverage < MIN_REGION_PIXELS) return 'too small to judge';
  if (score.addedTexture > MAX_ADDED_TEXTURE) return 'added texture that is not in the original';
  if (score.detail < policy.minDetail || score.worstBlock < policy.minWorst) return 'lost real detail';
  if (!(score.noiseBefore > 0) || score.noiseAfter > score.noiseBefore * (1 - MIN_NOISE_DROP)) return 'did not reduce the noise';
  return null;
}

/**
 * Pick each region's strength. `render` draws the whole recipe with every region at one strength from
 * `candidateLadder(requested)`; each rendering is scored for the regions whose ladder holds that strength, then dropped,
 * so at most one candidate image is alive at a time. Learned candidates are judged by the same rules, for the regions
 * they are offered to. In each region the passing candidate that removes the most noise wins: the region policy's
 * thresholds already say how much detail it may give up.
 */
export async function chooseRegions(
  original: Pixels,
  regions: ReadonlyArray<{ region: DenoiseRegion; weight: Float32Array }>,
  requested: number,
  render: (strength: number) => Promise<Pixels>,
  policies: Readonly<Record<DenoiseRegion, RegionPolicy>> = TRUEDETAIL_REGIONS,
  learned: readonly LearnedCandidate[] = [],
): Promise<RegionChoice[]> {
  const beforeLuma = lumaPlane(original);
  const allowed = regions.map(({ region }) => new Set(policies[region].ladder.map(share => scaledStrength(requested, share))));
  const verdicts: CandidateVerdict[][] = regions.map(() => []);
  for (const strength of candidateLadder(requested, policies, regions.map(r => r.region))) {
    const pixels = await render(strength);
    regions.forEach(({ region, weight }, i) => {
      if (!allowed[i].has(strength)) return;
      const score = scoreRegion(original, pixels, weight, beforeLuma);
      const reason = judgeRegion(score, policies[region]);
      verdicts[i].push({ source: 'conventional', strength, ok: reason === null, reason, score });
    });
  }
  for (const candidate of learned) {
    const wanted = regions.map(({ region }) => candidate.regions.includes(region));
    if (!wanted.some(Boolean)) continue;
    const pixels = await candidate.render();
    regions.forEach(({ region, weight }, i) => {
      if (!wanted[i]) return;
      const score = scoreRegion(original, pixels, weight, beforeLuma);
      const reason = judgeRegion(score, policies[region]);
      verdicts[i].push({ source: candidate.source, strength: candidate.strength, ok: reason === null, reason, score });
    });
  }
  return regions.map(({ region }, i) => {
    const pick = bestVerdict(verdicts[i]);
    const conventional = verdicts[i].filter(v => v.source === 'conventional');
    const last = conventional[conventional.length - 1] ?? verdicts[i][verdicts[i].length - 1];
    return { region, source: pick?.source ?? 'conventional', strength: pick?.strength ?? 0, verdicts: verdicts[i],
      kept: pick ? null : last ? `even the gentlest candidate ${last.reason}` : 'no candidate was tried' };
  });
}

/** Region weights from a subject alpha and an optional eye alpha: they always sum to 1 per pixel. */
export function regionWeights(subject: Float32Array, eyes?: Float32Array): { background: Float32Array; subject: Float32Array; eyes?: Float32Array } {
  const background = new Float32Array(subject.length), body = new Float32Array(subject.length);
  const eye = eyes ? new Float32Array(subject.length) : undefined;
  for (let p = 0; p < subject.length; p++) {
    const s = Math.max(0, Math.min(1, subject[p]));
    const e = eyes ? Math.max(0, Math.min(1, eyes[p])) * s : 0;
    background[p] = 1 - s; body[p] = s - e;
    if (eye) eye[p] = e;
  }
  return { background, subject: body, ...(eye ? { eyes: eye } : {}) };
}

/** Every strength any region policy wants rendered, strongest first, scaled by the requested strength and capped at 2. */
export function candidateLadder(requested: number, policies: Readonly<Record<DenoiseRegion, RegionPolicy>> = TRUEDETAIL_REGIONS, regions: readonly DenoiseRegion[] = ['background', 'subject', 'eyes']): number[] {
  const values = new Set<number>();
  for (const r of regions) for (const share of policies[r].ladder) values.add(scaledStrength(requested, share));
  return [...values].filter(v => v > 0).sort((a, b) => b - a);
}

export const scaledStrength = (requested: number, share: number) => Math.round(Math.min(2, Math.max(0, requested * share)) * 1000) / 1000;

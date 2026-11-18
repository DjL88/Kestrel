import { applyDetail, applyPhotoEdit, isNeutralEdit, type PhotoEdit } from './photoEdits';
import { applyMasks, fullContext } from './masks';
import { assessAutoQuality } from './autoQualityGate';
import type { LocalEdit, SubjectGrid } from './maskTypes';

/**
 * Kestrel Natural Auto: the one automatic-edit engine for the editor and for batch keepers.
 *
 * It replaces the full-frame histogram rules of `autoEnhance` and the AI Studio `studioAutoEnhance` heuristic with
 * measurements of what matters in a wildlife photograph:
 *  - the subject (a trusted segmentation mask) or, without one, the in-focus textured part of the frame;
 *  - smooth bright areas (sky, bokeh) versus textured highlights that can actually lose detail;
 *  - whether dark areas contain real structure or only noise and out-of-focus blur;
 *  - colours that are already rich (warm plumage, foliage) and must not be pushed.
 *
 * It only chooses ordinary, reversible slider values. It never synthesises pixels and adds no global sharpening,
 * clarity or texture. Analysis is bit-depth agnostic: 8-bit and 16-bit RGBA previews are both accepted.
 */

export type RgbaPixels = Uint8ClampedArray | Uint16Array;
export type SubjectConfidence = 'high' | 'medium' | 'low';
export type SceneKind = 'balanced' | 'bright-background' | 'low-key' | 'subdued' | 'underexposed' | 'overexposed' | 'flat';

export interface NaturalAutoInput {
  pixels: RgbaPixels;
  width: number;
  height: number;
  /** A segmentation grid from the on-device detector. Ignored unless it is trustworthy. */
  segmentation?: { grid: SubjectGrid; confidence: SubjectConfidence } | null;
  /**
   * Capture ISO when known. A small preview averages noise away, so high ISO is the honest signal that a
   * full-resolution shadow lift would show grain.
   */
  iso?: number | null;
}

export type GlobalAutoEdit = Pick<PhotoEdit, 'exposure' | 'warmth'> &
  Required<Pick<PhotoEdit, 'shadows' | 'highlights' | 'contrast' | 'vibrance'>>;

export interface SceneReport {
  kind: SceneKind;
  /** Which pixels drove exposure: the detected subject, the in-focus detail, or the whole frame. */
  reference: 'subject' | 'detail' | 'frame';
  referenceCoverage: number;
  referenceMedian: number;
  referenceP98: number;
  frameMedian: number;
  brightSmooth: number;
  brightTextured: number;
  shadowArea: number;
  shadowNoisy: number;
  shadowStructured: number;
  meanChroma: number;
  referenceChroma: number;
  warmRich: number;
  vividGreen: number;
}

export interface NaturalAutoResult {
  edit: GlobalAutoEdit;
  /** Optional extra local adjustment for the subject mask (never applied without a validated mask). */
  subjectEdit: LocalEdit | null;
  notes: string[];
  scene: SceneReport;
  /** True when Kestrel decided the photo already works and suggests nothing. */
  abstained: boolean;
}

const EMPTY: GlobalAutoEdit = { exposure: 0, warmth: 0, shadows: 0, highlights: 0, contrast: 0, vibrance: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 20) / 20;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toPerceptual = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
const LINEAR_8 = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
/** Slider units: exposure 1 is 0.4 EV (see `editParams`). */
const EV_PER_UNIT = 0.4;
const MAX_ANALYSIS_PIXELS = 1_200_000;
const BINS = 1024;

function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d <= 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/**
 * Decode a detector grid to per-pixel subject weights (0 to 1). Returns null for a malformed grid.
 * Nearest-cell sampling matches `insightSubjectAuto`, so both agree on which pixels are subject.
 */
export function subjectWeights(grid: SubjectGrid, width: number, height: number): Float32Array | null {
  const { w, h, data } = grid;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 8 || h < 8 || w > 512 || h > 512 || typeof data !== 'string') return null;
  let decoded: string;
  try { decoded = atob(data); } catch { return null; }
  if (decoded.length !== w * h) return null;
  const weights = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(h - 1, Math.floor((y * h) / height));
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(w - 1, Math.floor((x * w) / width));
      weights[y * width + x] = decoded.charCodeAt(gy * w + gx) / 255;
    }
  }
  return weights;
}

interface Analysis {
  width: number;
  height: number;
  lum: Float32Array; // perceptual luminance 0..1
  chroma: Float32Array;
  hue: Float32Array;
  rLin: Float32Array;
  bLin: Float32Array;
  /** Per-pixel block class: 0 smooth, 1 ordinary, 2 textured, 3 noise-dominated. */
  blockClass: Uint8Array;
  blockOf: (i: number) => number;
  blockMean: Float32Array;
  blockCount: number;
  energy: Float32Array; // per-block pixel-scale gradient
  brightDetail: Uint8Array;
}

/**
 * Block energy (mean neighbour difference) separates smooth sky and bokeh from detail. Noise is told from texture by
 * the image's own noise floor: most of a noisy frame shares one energy level, and detail rises clearly above it.
 * (A two-scale coherence ratio was tried and measured: it does not separate fine feather texture from noise.)
 */
function analyse(pixels: RgbaPixels, width: number, height: number): Analysis {
  const n = width * height;
  const sixteen = pixels instanceof Uint16Array;
  const lum = new Float32Array(n), chroma = new Float32Array(n), hue = new Float32Array(n);
  const rLin = new Float32Array(n), bLin = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i += 1, j += 4) {
    const r = sixteen ? toLinear(pixels[j] / 65535) : LINEAR_8[pixels[j]];
    const g = sixteen ? toLinear(pixels[j + 1] / 65535) : LINEAR_8[pixels[j + 1]];
    const b = sixteen ? toLinear(pixels[j + 2] / 65535) : LINEAR_8[pixels[j + 2]];
    rLin[i] = r; bLin[i] = b;
    lum[i] = toPerceptual(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const hi = Math.max(r, g, b);
    chroma[i] = hi > 0 ? (hi - Math.min(r, g, b)) / hi : 0;
    hue[i] = hueOf(r, g, b);
  }
  const B = Math.max(4, Math.round(Math.max(width, height) / 64));
  const bw = Math.ceil(width / B), bh = Math.ceil(height / B), blocks = bw * bh;
  const g1 = new Float32Array(blocks), c1 = new Float32Array(blocks);
  const brightDetail = new Uint8Array(n);
  const mean = new Float32Array(blocks), cm = new Float32Array(blocks), sq = new Float32Array(blocks);
  const low = new Float32Array(blocks).fill(1), spread = new Float32Array(blocks);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x, k = Math.floor(y / B) * bw + Math.floor(x / B);
      mean[k] += lum[i]; sq[k] += lum[i] * lum[i]; cm[k] += 1;
      if (lum[i] < low[k]) low[k] = lum[i];
      if (x + 1 < width && y + 1 < height) {
            g1[k] += Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i + width]);
        c1[k] += 1;
      }
    }
  }
  const cls = new Uint8Array(blocks), energy = new Float32Array(blocks);
  for (let k = 0; k < blocks; k += 1) {
    mean[k] = cm[k] ? mean[k] / cm[k] : 0;
    spread[k] = cm[k] ? Math.sqrt(Math.max(0, sq[k] / cm[k] - mean[k] * mean[k])) : 0;
    energy[k] = c1[k] ? g1[k] / c1[k] : 0;
  }
  const sorted = Float32Array.from(energy).sort();
  const floor = sorted[Math.floor(sorted.length * 0.3)] ?? 0;
  const noiseFloor = floor > 0.008 ? floor : 0;
  for (let k = 0; k < blocks; k += 1) {
    const e = energy[k];
    // Smooth means no visible tonal variation (sky, bokeh), judged on spread so mild grain does not break it.
    cls[k] = spread[k] < 0.012 ? 0 : e > Math.max(0.015, 1.4 * noiseFloor) ? 2 : noiseFloor && e <= 1.4 * noiseFloor ? 3 : 1;
  }
  // Textured highlight areas: bright throughout (not an edge), varying (not flat sky), carrying fine detail (not a soft
  // bokeh disc), and part of an area rather than a thin line along a sky or crown boundary (two or more such neighbours).
  const brightBlock = new Uint8Array(blocks);
  for (let k = 0; k < blocks; k += 1) brightBlock[k] = low[k] > 0.75 && spread[k] > 0.015 && cls[k] === 2 ? 1 : 0;
  const brightArea = new Uint8Array(blocks);
  for (let k = 0; k < blocks; k += 1) {
    if (!brightBlock[k]) continue;
    const x = k % bw, y = Math.floor(k / bw);
    const around = (x > 0 ? brightBlock[k - 1] : 0) + (x + 1 < bw ? brightBlock[k + 1] : 0) +
      (y > 0 ? brightBlock[k - bw] : 0) + (y + 1 < bh ? brightBlock[k + bw] : 0);
    brightArea[k] = around >= 2 ? 1 : 0;
  }
  const blockClass = new Uint8Array(n);
  const blockOf = (i: number) => Math.floor(Math.floor(i / width) / B) * bw + Math.floor((i % width) / B);
  for (let i = 0; i < n; i += 1) {
    const k = blockOf(i);
    blockClass[i] = cls[k];
    if (lum[i] > 0.9 && brightArea[k]) brightDetail[i] = 1;
  }
  return { width, height, lum, chroma, hue, rLin, bLin, blockClass, blockOf, blockMean: mean, blockCount: blocks, energy, brightDetail };
}

class Histogram {
  bins = new Float64Array(BINS);
  total = 0;
  add(value: number, weight = 1) {
    this.bins[Math.min(BINS - 1, Math.max(0, Math.floor(value * BINS)))] += weight;
    this.total += weight;
  }
  at(q: number): number {
    if (this.total <= 0) return 0;
    const goal = q * this.total;
    let run = 0;
    for (let i = 0; i < BINS; i += 1) {
      run += this.bins[i];
      if (run >= goal) return (i + 0.5) / BINS;
    }
    return 1;
  }
  /** Fraction of weight above a perceptual value once a linear gain is applied. */
  above(threshold: number, gain = 1): number {
    if (this.total <= 0) return 0;
    let count = 0;
    const limit = toLinear(threshold);
    for (let i = 0; i < BINS; i += 1) if (toLinear((i + 0.5) / BINS) * gain > limit) count += this.bins[i];
    return count / this.total;
  }
}

function emptyScene(): SceneReport {
  return {
    kind: 'balanced', reference: 'frame', referenceCoverage: 0, referenceMedian: 0, referenceP98: 0, frameMedian: 0,
    brightSmooth: 0, brightTextured: 0, shadowArea: 0, shadowNoisy: 0, shadowStructured: 0,
    meanChroma: 0, referenceChroma: 0, warmRich: 0, vividGreen: 0,
  };
}

/** Choose a natural, reversible recipe for an unedited preview. Never commits anything. */
export function naturalAuto(input: NaturalAutoInput): NaturalAutoResult {
  const { pixels, width, height } = input;
  const notes: string[] = [];
  const n = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 16 || height < 16 ||
      pixels.length !== n * 4 || n > MAX_ANALYSIS_PIXELS) {
    return { edit: { ...EMPTY }, subjectEdit: null, notes: ['This preview is too small or too large to analyse.'], scene: emptyScene(), abstained: true };
  }
  const a = analyse(pixels, width, height);

  // Reference region: a trustworthy subject first, else the in-focus textured detail, else the frame.
  let weights: Float32Array | null = null;
  let reference: SceneReport['reference'] = 'frame';
  if (input.segmentation && input.segmentation.confidence !== 'low') {
    const decoded = subjectWeights(input.segmentation.grid, width, height);
    if (decoded) {
      let core = 0;
      for (let i = 0; i < n; i += 1) if (decoded[i] >= 200 / 255) core += 1;
      if (core / n >= 0.02 && core / n <= 0.75) { weights = decoded; reference = 'subject'; }
    }
  }
  if (!weights) {
    let textured = 0;
    for (let i = 0; i < n; i += 1) if (a.blockClass[i] === 2) textured += 1;
    if (textured / n >= 0.03 && textured / n <= 0.85) {
      weights = new Float32Array(n);
      for (let i = 0; i < n; i += 1) weights[i] = a.blockClass[i] === 2 ? 1 : 0;
      reference = 'detail';
    }
  }
  const isRef = (i: number) => (weights ? weights[i] >= (reference === 'subject' ? 200 / 255 : 0.5) : true);

  // refHi is the highlight evidence. For block-based detail a bright pixel counts only when it has bright, textured
  // neighbours: next to a subject's edge bright pixels are sky or bokeh, and without a mask a blown area cannot be
  // told from a white sky, so it is not acted on.
  const frame = new Histogram(), ref = new Histogram(), refHi = new Histogram();
  let refCount = 0, chromaSum = 0, refChroma = 0, warmRich = 0, vividGreen = 0, brightSmooth = 0, brightTextured = 0;
  let neutralR = 0, neutralB = 0, neutral = 0, shadowArea = 0;
  for (let i = 0; i < n; i += 1) {
    const L = a.lum[i], c = a.chroma[i], h = a.hue[i], cls = a.blockClass[i];
    frame.add(L);
    chromaSum += c;
    if (isRef(i)) {
      ref.add(L); refCount += 1; refChroma += c;
      if (reference !== 'detail' || L <= 0.9 || a.brightDetail[i]) refHi.add(L);
    }
    if (L > 0.2 && c > 0.45 && h >= 8 && h <= 50) warmRich += 1;
    if (L > 0.15 && c > 0.4 && h >= 70 && h <= 170) vividGreen += 1;
    if (L > 0.92 && cls === 0) brightSmooth += 1;
    if (a.brightDetail[i]) brightTextured += 1;
    if (L < 0.12) shadowArea += 1;
    // Colour balance only from near-neutral midtones that are not the subject: feathers are never a "cast".
    if (L > 0.2 && L < 0.8 && c < 0.15 && !(reference === 'subject' && weights && weights[i] > 0.3)) {
      neutralR += a.rLin[i]; neutralB += a.bLin[i]; neutral += 1;
    }
  }
  let shadowBlocks = 0, noisyBlocks = 0, structuredBlocks = 0;
  const blockClassOf = new Uint8Array(a.blockCount);
  for (let i = 0; i < n; i += 1) blockClassOf[a.blockOf(i)] = a.blockClass[i];
  for (let k = 0; k < a.blockCount; k += 1) {
    if (a.blockMean[k] >= 0.18) continue;
    shadowBlocks += 1;
    if (blockClassOf[k] === 3) noisyBlocks += 1;
    if (blockClassOf[k] === 2) structuredBlocks += 1;
  }

  const scene: SceneReport = {
    kind: 'balanced', reference,
    referenceCoverage: refCount / n,
    referenceMedian: ref.at(0.5), referenceP98: refHi.at(0.98), frameMedian: frame.at(0.5),
    brightSmooth: brightSmooth / n, brightTextured: brightTextured / n, shadowArea: shadowArea / n,
    shadowNoisy: shadowBlocks ? noisyBlocks / shadowBlocks : 0,
    shadowStructured: shadowBlocks ? structuredBlocks / shadowBlocks : 0,
    meanChroma: chromaSum / n, referenceChroma: refCount ? refChroma / refCount : 0,
    warmRich: warmRich / n, vividGreen: vividGreen / n,
  };
  const edit: GlobalAutoEdit = { ...EMPTY };
  const subjectEdit: LocalEdit = {};

  const refMedian = scene.referenceMedian, refP98 = scene.referenceP98;
  const brightBackground = scene.brightSmooth >= 0.06;
  const lowKey = frame.at(0.7) < 0.18 && ref.at(0.95) > 0.3;
  const subdued = !lowKey && scene.frameMedian < 0.32 && refMedian >= 0.16 &&
    scene.shadowArea > 0.25 && scene.shadowStructured < 0.35;
  const highIso = (input.iso ?? 0) >= 1600;
  const shadowsAreNoise = scene.shadowNoisy >= 0.3 || highIso;

  // Exposure follows the subject (or the in-focus detail), never a bright sky or bokeh.
  let gain = 1;
  // Perceptual 0.46 is mid-grey. A reference below about 0.6 EV under it is lifted towards 0.44; a subdued scene only
  // when its subject is genuinely dark.
  const target = lowKey || subdued ? 0.24 : 0.44;
  const darkThreshold = lowKey || subdued ? 0.16 : 0.37;
  const subjectDarkerThanBackground = reference === 'subject' && brightBackground;
  if (lowKey) {
    gain = 1;
  } else if (refMedian < darkThreshold && refMedian > 0) {
    const wanted = toLinear(target) / Math.max(toLinear(refMedian), 1e-4);
    const headroom = refP98 > 0 ? toLinear(0.96) / Math.max(toLinear(refP98), 1e-4) : wanted;
    gain = clamp(Math.min(wanted, Math.max(1, headroom)), 1, 2 ** (1.25 * EV_PER_UNIT));
    // With a bright background and a validated subject, the subject mask does the lifting instead.
    if (subjectDarkerThanBackground) gain = 1;
    else if (brightBackground) gain = Math.min(gain, 2 ** (0.25 * EV_PER_UNIT));
    // Without a subject or clear detail, a dark noisy frame may be a subdued scene, so lift only a little.
    else if (reference === 'frame' && shadowsAreNoise) gain = Math.min(gain, 2 ** (0.5 * EV_PER_UNIT));
  } else if (refHi.above(0.975) > 0.02 && refP98 > 0.975) {
    // Only darken when the subject or the in-focus detail itself is blown, not the sky behind it.
    gain = clamp(toLinear(0.94) / Math.max(toLinear(refP98), 1e-4), 2 ** (-0.75 * EV_PER_UNIT), 1);
  }
  edit.exposure = clamp(round(Math.log2(gain) / EV_PER_UNIT), -0.75, 1.25);
  if (Math.abs(edit.exposure) < 0.1) edit.exposure = 0;
  const appliedGain = 2 ** (edit.exposure * EV_PER_UNIT);
  if (edit.exposure > 0) notes.push(reference === 'subject' ? 'The subject is on the dark side, so exposure goes up a little.' :
    'The photo is on the dark side, so exposure goes up a little.');
  else if (edit.exposure < 0) notes.push('Bright detail on the subject is blown out, so exposure comes down a little.');

  // Highlights: recover only where detail can be lost. A smooth white sky or bright bokeh is left as it is.
  const refBright = refHi.above(0.95, appliedGain);
  const texturedClipping = scene.brightTextured * (appliedGain > 1 ? appliedGain : 1);
  if (refBright > 0.01 || texturedClipping > 0.004) {
    edit.highlights = -clamp(round(0.3 + refBright * 8), 0.3, 0.8);
    notes.push('Bright detail is close to clipping, so highlights are recovered gently.');
  } else if (brightBackground) {
    notes.push('The bright background looks intentional, so it stays bright.');
  }

  // Shadows: lift only dark areas that hold real structure, never noise or out-of-focus foliage.
  if (lowKey) {
    notes.push('A lit subject against a dark scene: the mood is kept, so exposure and shadows stay put.');
  } else if (scene.shadowArea > 0.12) {
    if (shadowsAreNoise || subdued || scene.shadowStructured < 0.3) {
      notes.push(highIso ? 'High ISO: lifting dark areas would show grain at full size, so shadows are left alone.' :
        'Dark areas are noisy or out of focus, so they are not lifted into grey.');
    } else {
      const p05 = toPerceptual(Math.min(1, toLinear(ref.at(0.05)) * appliedGain));
      edit.shadows = clamp(round(((0.12 - p05) / 0.12) * 0.8), 0, 0.6);
      if (edit.shadows < 0.1) edit.shadows = 0;
      else notes.push('Dark areas hold detail, so shadows open slightly.');
    }
  }

  // Dark, textured subject detail (a mottled bird in woodland) is recovered locally, not across the frame.
  if (reference === 'subject' && input.segmentation?.confidence !== 'low' && ref.at(0.1) < 0.12) {
    subjectEdit.shadows = 0.3;
    notes.push('Dark feather detail on the subject is opened locally; the background keeps its mood.');
  }

  // Contrast only for a genuinely flat subject, and never against an intentional high-key or low-key look.
  const spread = ref.at(0.95) - ref.at(0.05);
  // Contrast runs per channel, so in a colour-rich scene it would also push saturation: leave those alone.
  const colourRich = scene.warmRich >= 0.02 || scene.vividGreen >= 0.1;
  if (!lowKey && !subdued && !brightBackground && !colourRich && spread < 0.3 && spread >= 0.08) {
    edit.contrast = clamp(round(((0.3 - spread) / 0.3) * 0.4), 0, 0.3);
    if (edit.contrast < 0.1) edit.contrast = 0;
    else notes.push('Tones on the subject are bunched together, so contrast goes up a little.');
  }

  // Colour balance from near-neutral midtones outside the subject.
  if (neutral / n >= 0.08 && neutralR + neutralB > 0) {
    const cast = (neutralB - neutralR) / (neutralB + neutralR);
    const warmth = clamp(round((cast / 0.08) * 0.6), -1, 1);
    // Below 0.2 the shift is invisible and within measurement error, so it is not worth a change.
    if (Math.abs(warmth) >= 0.2) {
      edit.warmth = warmth;
      notes.push(warmth > 0 ? 'Neutral areas looked cool, so warmth goes up slightly.' : 'Neutral areas looked warm, so warmth goes down slightly.');
    }
  } else {
    notes.push('No clear neutral areas, so colour balance is left alone.');
  }

  // Vibrance only for genuinely muted scenes. Rich plumage and foliage are protected.
  if (scene.warmRich >= 0.02) notes.push('Warm feather colours are already rich, so they are not boosted.');
  else if (scene.vividGreen >= 0.1) notes.push('Greens are already strong, so vibrance is left alone.');
  else if (scene.meanChroma < 0.02) notes.push('The photo is close to monochrome, so colour is left alone.');
  else if (scene.meanChroma < 0.15 && scene.referenceChroma < 0.35) {
    edit.vibrance = 0.25;
    notes.push('Colours are muted, so vibrance goes up gently. Saturation is untouched.');
  }

  // No global sharpening, clarity or texture: they would crunch bokeh. A clean, sharp subject may get a light local touch.
  if (reference === 'subject' && input.segmentation?.confidence === 'high' && weights && !highIso) {
    let refTextured = 0, refNoisy = 0;
    for (let i = 0; i < n; i += 1) if (isRef(i)) { if (a.blockClass[i] === 2) refTextured += 1; else if (a.blockClass[i] === 3) refNoisy += 1; }
    if (refCount && refTextured / refCount >= 0.4 && refNoisy / refCount < 0.1) {
      subjectEdit.sharpen = 0.2;
      notes.push('The subject has clean, fine detail, so it gets a light local sharpen. The background is not sharpened.');
    }
  }

  scene.kind = lowKey ? 'low-key' : subdued ? 'subdued' : brightBackground ? 'bright-background' :
    edit.exposure > 0 ? 'underexposed' : edit.exposure < 0 ? 'overexposed' : edit.contrast > 0 ? 'flat' : 'balanced';
  const globalChanged = Object.values(edit).some((v) => v !== 0);
  const localChanged = Object.keys(subjectEdit).length > 0;
  const abstained = !globalChanged && !localChanged;
  if (abstained) notes.push('This photo already works, so Kestrel leaves it as it is.');
  return { edit, subjectEdit: localChanged ? subjectEdit : null, notes, scene, abstained };
}

/** Render a recipe on an 8-bit preview with the same CPU maths export uses (tone, detail, masks). */
export function renderRecipePreview(source: Uint8ClampedArray, width: number, height: number, edit: PhotoEdit): Uint8ClampedArray {
  const out = new Uint8ClampedArray(source);
  if (isNeutralEdit(edit)) return out;
  applyPhotoEdit(out, edit);
  applyDetail(out, width, height, edit, Math.max(width, height));
  applyMasks(out, width, height, edit.masks, fullContext(width, height));
  return out;
}

export interface NaturalGate { safe: boolean; reason: string }

/**
 * Objective checks for an automatic recipe, on top of the existing clipping and hue guard. These are preview
 * measurements, not proof of RAW colour accuracy. They block, rather than judge taste.
 */
export function assessNaturalAuto(
  before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number,
  segmentation?: NaturalAutoInput['segmentation'],
): NaturalGate {
  const base = assessAutoQuality(before, after);
  if (!base.safe) return base;
  const n = width * height;
  if (before.length !== n * 4) return { safe: false, reason: 'Preview dimensions are inconsistent' };
  const weights = segmentation && segmentation.confidence !== 'low' ? subjectWeights(segmentation.grid, width, height) : null;
  const A = analyse(before, width, height);
  const B = analyse(after, width, height);
  let sCount = 0, sClipBefore = 0, sClipAfter = 0, sChromaBefore = 0, sChromaAfter = 0, hueDrift = 0, hueCount = 0;
  let bgCount = 0, bgEnergyBefore = 0, bgEnergyAfter = 0, bgPixels = 0, bgColourBefore = 0, bgColourAfter = 0;
  // Colourfulness on display values (max minus min channel). Unlike a linear chroma ratio it keeps rising as rich
  // plumage or foliage is pushed further, so it can see over-saturation.
  // Compared against the change in brightness, so an exposure lift alone is not mistaken for saturation.
  const bright = (p: Uint8ClampedArray, j: number) => (p[j] + p[j + 1] + p[j + 2]) / 765;
  let sLumBefore = 0, sLumAfter = 0, bgLumBefore = 0, bgLumAfter = 0;
  const colourful = (p: Uint8ClampedArray, j: number) => (Math.max(p[j], p[j + 1], p[j + 2]) - Math.min(p[j], p[j + 1], p[j + 2])) / 255;
  let brightCount = 0, brightBefore = 0, brightAfter = 0;
  let noisyCount = 0, noisyBefore = 0, noisyAfter = 0;
  const seenBlock = new Uint8Array(A.blockCount);
  for (let i = 0; i < n; i += 1) {
    const j = i * 4;
    const subject = weights ? weights[i] >= 200 / 255 : A.blockClass[i] === 2;
    const background = weights ? weights[i] <= 55 / 255 && A.blockClass[i] !== 2 : A.blockClass[i] === 0 || A.blockClass[i] === 1;
    if (subject) {
      sCount += 1;
      if (Math.max(before[j], before[j + 1], before[j + 2]) >= 254) sClipBefore += 1;
      if (Math.max(after[j], after[j + 1], after[j + 2]) >= 254) sClipAfter += 1;
      sChromaBefore += colourful(before, j); sChromaAfter += colourful(after, j);
      sLumBefore += bright(before, j); sLumAfter += bright(after, j);
      if (A.chroma[i] > 0.35 && B.chroma[i] > 0.2 && A.lum[i] > 0.15) {
        const d = Math.abs(A.hue[i] - B.hue[i]);
        hueDrift += Math.min(d, 360 - d); hueCount += 1;
      }
    }
    if (background) {
      bgPixels += 1; bgColourBefore += colourful(before, j); bgColourAfter += colourful(after, j);
      bgLumBefore += bright(before, j); bgLumAfter += bright(after, j);
    }
    const k = A.blockOf(i);
    if (background && !seenBlock[k]) {
      seenBlock[k] = 1;
      bgCount += 1; bgEnergyBefore += A.energy[k]; bgEnergyAfter += B.energy[k];
      if (A.blockClass[i] === 3 && A.blockMean[k] < 0.18) { noisyCount += 1; noisyBefore += A.energy[k]; noisyAfter += B.energy[k]; }
    }
    if (A.lum[i] > 0.9 && A.blockClass[i] === 0 && !subject) { brightCount += 1; brightBefore += A.lum[i]; brightAfter += B.lum[i]; }
  }
  if (sCount >= 32) {
    if ((sClipAfter - sClipBefore) / sCount > 0.005) return { safe: false, reason: 'The subject would lose highlight detail' };
    const lift = sLumBefore > 0 ? Math.max(1, sLumAfter / sLumBefore) : 1;
    if (sChromaBefore > 0 && sChromaAfter / sChromaBefore / lift > 1.12) return { safe: false, reason: 'Subject colours would be pushed too far' };
    if (hueCount >= 32 && hueDrift / hueCount > 6) return { safe: false, reason: 'Subject colours would shift' };
  }
  if (bgPixels >= 64 && bgColourBefore / bgPixels > 0.1 && bgColourAfter / bgColourBefore / Math.max(1, bgLumBefore > 0 ? bgLumAfter / bgLumBefore : 1) > 1.12) {
    return { safe: false, reason: 'Background colours would be pushed too far' };
  }
  if (bgCount >= 4 && bgEnergyBefore > 0 && bgEnergyAfter / bgEnergyBefore > 1.2 && (bgEnergyAfter - bgEnergyBefore) / bgCount > 0.002) {
    return { safe: false, reason: 'The out-of-focus background would look crunchier' };
  }
  if (noisyCount >= 4 && noisyBefore > 0 && noisyAfter / noisyBefore > 1.5) {
    return { safe: false, reason: 'Noisy shadows would be brightened into grey' };
  }
  if (brightCount / n >= 0.03 && (brightBefore - brightAfter) / brightCount > 0.06 && sClipAfter >= sClipBefore) {
    return { safe: false, reason: 'The bright background would be flattened' };
  }
  return { safe: true, reason: 'Within subject, background and clipping limits' };
}

/** Scale every suggested value, global and local, so a failed recipe can be retried at half strength. */
export function scaleRecipe(base: PhotoEdit, proposal: PhotoEdit, factor: number): PhotoEdit {
  const out: PhotoEdit = { ...proposal };
  for (const key of ['exposure', 'warmth', 'shadows', 'highlights', 'contrast', 'vibrance'] as const) {
    const from = base[key] ?? 0, to = proposal[key] ?? 0;
    if (to !== from) out[key] = round(from + (to - from) * factor);
  }
  const baseIds = new Set((base.masks ?? []).map((m) => m.id));
  out.masks = proposal.masks?.map((mask) => baseIds.has(mask.id) ? mask : {
    ...mask, edit: Object.fromEntries(Object.entries(mask.edit).map(([k, v]) => [k, round((v ?? 0) * factor)])) as LocalEdit,
  });
  if (!out.masks?.length && !base.masks) delete out.masks;
  return out;
}

/** Same look: every control equal (absent means 0) and the same masks. */
export function sameRecipe(a: PhotoEdit, b: PhotoEdit): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== 'masks'));
  for (const key of keys) if (((a as unknown as Record<string, number>)[key] ?? 0) !== ((b as unknown as Record<string, number>)[key] ?? 0)) return false;
  return JSON.stringify(a.masks ?? []) === JSON.stringify(b.masks ?? []);
}

export type StagedOutcome = 'full' | 'gentler' | 'declined' | 'nothing-needed';

/**
 * Staged fallback: the full recipe, then half strength, then nothing. Every stage is rendered and checked first.
 * The first stage that passes is returned; a declined recipe leaves the photograph exactly as it was.
 * `source` is the unedited preview; each candidate is judged against the photographer's current look (`base`).
 */
export function stageNaturalRecipe(
  source: Uint8ClampedArray, width: number, height: number, base: PhotoEdit, proposal: PhotoEdit,
  segmentation?: NaturalAutoInput['segmentation'],
): { edit: PhotoEdit; outcome: StagedOutcome; reason: string } {
  if (sameRecipe(base, proposal)) return { edit: base, outcome: 'nothing-needed', reason: 'Nothing to change' };
  let last = '';
  const before = renderRecipePreview(source, width, height, base);
  for (const [factor, outcome] of [[1, 'full'], [0.5, 'gentler']] as const) {
    const candidate = factor === 1 ? proposal : scaleRecipe(base, proposal, factor);
    const verdict = assessNaturalAuto(before, renderRecipePreview(source, width, height, candidate), width, height, segmentation);
    if (verdict.safe) return { edit: candidate, outcome, reason: verdict.reason };
    last = verdict.reason;
  }
  return { edit: base, outcome: 'declined', reason: last };
}

/** Plain-language summary of a staged result for the editor and batch report. */
export function describeOutcome(outcome: StagedOutcome, reason: string): string {
  if (outcome === 'full') return 'Checked: no new clipping, colour shift or background sharpening.';
  if (outcome === 'gentler') return `The full suggestion failed a check (${reason.toLowerCase()}), so a gentler version is offered.`;
  if (outcome === 'declined') return `Kestrel declined to change this photo: ${reason.toLowerCase()}.`;
  return 'This photo already works, so nothing changes.';
}

import type { PhotoEdit } from './photoEdits';

/** Apply only meaningful, finite suggestions. A neutral recommendation must never erase manual adjustments. */
export function mergeAutoSuggestion(current: PhotoEdit, suggestion: AutoResult['edit']): { edit: PhotoEdit; changed: boolean } {
  const edit: PhotoEdit = { ...current };
  let changed = false;
  for (const key of Object.keys(suggestion) as (keyof AutoResult['edit'])[]) {
    const value = suggestion[key];
    if (!Number.isFinite(value) || value === 0 || (current[key] ?? 0) === value) continue;
    edit[key] = value;
    changed = true;
  }
  return { edit, changed };
}

export interface AutoResult {
  edit: Record<'exposure' | 'warmth' | 'shadows' | 'highlights' | 'contrast' | 'vibrance', number>;
  /** Plain-English reasons, shown to the user so the result is never a black box. */
  notes: string[];
}

const toLinear = (byte: number) => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toPerceptual = (linear: number) => (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number) => Math.round(value * 20) / 20;

/**
 * Local, rule-based suggestions from a small preview of the unedited photo. No network, no generative AI.
 * Colour balance uses only near-neutral midtones, so a green forest or orange bird does not read as a colour cast.
 */
export function autoEnhance(pixels: Uint8ClampedArray): AutoResult {
  const notes: string[] = [];
  const lumas: number[] = [];
  let r = 0;
  let g = 0;
  let b = 0;
  let neutral = 0;
  let chromaSum = 0;
  const count = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    const lr = toLinear(pixels[i]);
    const lg = toLinear(pixels[i + 1]);
    const lb = toLinear(pixels[i + 2]);
    const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    lumas.push(y);
    const high = Math.max(lr, lg, lb);
    const chroma = high > 0 ? (high - Math.min(lr, lg, lb)) / high : 0;
    chromaSum += chroma;
    const p = toPerceptual(y);
    if (p > 0.15 && p < 0.85 && chroma < 0.3) {
      r += lr;
      g += lg;
      b += lb;
      neutral += 1;
    }
  }
  lumas.sort((x, y) => x - y);
  const at = (q: number) => lumas[Math.min(lumas.length - 1, Math.floor(q * lumas.length))];
  const result: AutoResult['edit'] = { exposure: 0, warmth: 0, shadows: 0, highlights: 0, contrast: 0, vibrance: 0 };
  if (count < 64) return { edit: result, notes: ['Too small to analyse.'] };

  // Colour balance from near-neutral pixels only.
  if (neutral / count >= 0.05 && r + b > 0) {
    const cast = (b - r) / (b + r);
    const warmth = clamp(round((cast / 0.08) * 0.7), -2, 2);
    if (Math.abs(warmth) >= 0.1) {
      result.warmth = warmth;
      notes.push(warmth > 0 ? 'Neutral areas looked cool, so warmth goes up.' : 'Neutral areas looked warm, so warmth goes down.');
    } else notes.push('Colour balance already looks neutral.');
  } else notes.push('No clear neutral areas, so colour balance is left alone.');

  // Exposure: only lift a photo that is really dark. A bright sky or a pale scene is often meant to be bright, so a high median
  // never darkens a photo on its own: it is only pulled down when the brightest tones are actually blown out.
  const median = at(0.5);
  const medianTone = toPerceptual(median);
  const p99 = at(0.99);
  let gain = 1;
  if (medianTone < 0.38) {
    gain = clamp((0.42 ** 2.2) / Math.max(median, 0.002), 1, 2.2);
    if (p99 * gain > 1) gain = Math.max(1, 1 / Math.max(p99, 0.01));
  } else if (toPerceptual(p99) > 0.985 && medianTone > 0.6) {
    gain = clamp(0.9 / Math.max(p99, 0.01), 0.6, 1);
  }
  const exposure = clamp(round(Math.log2(gain) / 0.4), -1, 1.25);
  if (Math.abs(exposure) >= 0.1) {
    result.exposure = exposure;
    notes.push(exposure > 0 ? 'Photo is on the dark side, so exposure goes up.' : 'Brightest areas are blown out, so exposure goes down.');
  }

  const after = (y: number) => toPerceptual(Math.min(1, y * 2 ** (result.exposure * 0.4)));
  const lowTone = after(at(0.05));
  const highTone = after(at(0.98));
  if (lowTone < 0.12) {
    result.shadows = clamp(round(((0.12 - lowTone) / 0.12) * 1.5), 0, 1.5);
    if (result.shadows >= 0.1) notes.push('Dark areas are heavy, so shadows are lifted.');
  }
  if (highTone > 0.96) {
    result.highlights = -1;
    notes.push('Brightest areas are close to white, so highlights are pulled back.');
  }
  // Contrast follows how flat the photo really is, so a photo that is already balanced is left alone.
  const spread = after(at(0.95)) - lowTone;
  const flat = clamp(round(((0.4 - spread) / 0.4) * 0.6), 0, 0.6);
  // A featureless frame (a plain sky) has nothing for contrast to work on.
  if (flat >= 0.15 && spread >= 0.08) {
    result.contrast = flat;
    notes.push('Tones are bunched together, so contrast goes up a little.');
  }
  if (!Object.values(result).some(Boolean)) notes.push('This photo already looks balanced, so it is left as it is.');
  if (chromaSum / count < 0.18) {
    result.vibrance = 0.5;
    notes.push('Colours are muted, so vibrance goes up. Saturation is untouched.');
  }
  return { edit: result, notes };
}

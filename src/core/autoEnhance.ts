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
  // Low-key: most of the frame is very dark but a clearly lit area stands out (a bird against a dark wood, a moon, a stage).
  // The darkness is the mood, so brightening the whole scene would work against the photo. A merely underexposed photo has
  // no lit area, so it is still lifted.
  const accent = toPerceptual(at(0.99));
  const lowKey = toPerceptual(at(0.7)) < 0.12 && accent > 0.25 && accent - medianTone > 0.2; // Measured on a kingfisher: 70% below 0.05, lit bird about 0.31.
  let gain = 1;
  if (lowKey) {
    notes.push('This looks intentionally dark: a lit subject against a dark scene. Exposure and shadows are left alone to keep the mood.');
  } else if (medianTone < 0.38) {
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
  if (!lowKey && lowTone < 0.12) {
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
  if (!lowKey && flat >= 0.15 && spread >= 0.08) {
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

export interface StudioAutoResult {
  edit: Partial<PhotoEdit>;
  notes: string[];
}

/**
 * Calibrated studio-grade finish built on top of `autoEnhance`.
 * Adds micro-contrast clarity, balanced highlight protection, and a gentle filmic
 * tone lift when a well-exposed shot would otherwise come back as neutral zeros.
 * Respects intentionally low-key scenes and featureless skies cleanly.
 */
export function studioAutoEnhance(pixels: Uint8ClampedArray, width?: number, height?: number): StudioAutoResult {
  const base = autoEnhance(pixels);
  const edit: Partial<PhotoEdit> = { ...base.edit };
  const notes = base.notes.filter((n) => n !== 'This photo already looks balanced, so it is left as it is.');
  const count = pixels.length / 4;
  if (count < 64) return { edit, notes: base.notes };

  const lumas: number[] = [];
  let chromaSum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const lr = toLinear(pixels[i]);
    const lg = toLinear(pixels[i + 1]);
    const lb = toLinear(pixels[i + 2]);
    const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    lumas.push(y);
    const high = Math.max(lr, lg, lb);
    chromaSum += high > 0 ? (high - Math.min(lr, lg, lb)) / high : 0;
  }
  lumas.sort((x, y) => x - y);
  const at = (q: number) => lumas[Math.min(lumas.length - 1, Math.floor(q * lumas.length))];

  const after = (y: number) => toPerceptual(Math.min(1, y * 2 ** ((edit.exposure ?? 0) * 0.4)));
  const p05 = after(at(0.05));
  const p15 = after(at(0.15));
  const p50 = after(at(0.5));
  const p95 = after(at(0.95));
  const p98 = after(at(0.98));
  const spread = p95 - p05;
  const accent = toPerceptual(at(0.99));
  const lowKey = toPerceptual(at(0.7)) < 0.12 && accent > 0.25 && accent - toPerceptual(at(0.5)) > 0.2;

  // Measure texture density if dimensions are available (or estimate square grid)
  let detail = 0;
  const w = width && height && width * height === count ? width : Math.floor(Math.sqrt(count));
  const h = width && height && width * height === count ? height : Math.floor(count / Math.max(1, w));
  if (w >= 16 && h >= 16) {
    let sum = 0;
    let samples = 0;
    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const i = (y * w + x) * 4;
        const c = 0.213 * pixels[i] + 0.715 * pixels[i + 1] + 0.072 * pixels[i + 2];
        const r = 0.213 * pixels[i + 4] + 0.715 * pixels[i + 5] + 0.072 * pixels[i + 6];
        const d = 0.213 * pixels[i + w * 4] + 0.715 * pixels[i + w * 4 + 1] + 0.072 * pixels[i + w * 4 + 2];
        sum += Math.abs(c - r) + Math.abs(c - d);
        samples += 1;
      }
    }
    detail = sum / Math.max(1, samples);
  }

  // Gentle studio polish only on textured non-featureless photographs
  const hasSubjectTexture = spread >= 0.10 && detail >= 3.5;

  if (!lowKey && hasSubjectTexture) {
    if ((edit.highlights ?? 0) === 0 && p98 > 0.88) {
      edit.highlights = -0.35;
      notes.push('Bright highlight detail is preserved with gentle recovery.');
    }
    if ((edit.shadows ?? 0) === 0 && p15 < 0.22 && p50 > 0.24) {
      edit.shadows = 0.25;
      notes.push('Deep shadows are gently opened for tonal separation.');
    }
    if ((edit.contrast ?? 0) === 0 && spread < 0.72) {
      edit.contrast = 0.2;
      notes.push('Subtle contrast shapes midtone depth.');
    }
    if (chromaSum / count < 0.34 && (edit.vibrance ?? 0) === 0) {
      edit.vibrance = 0.2;
      notes.push('Gentle vibrance enriches muted tones without pushing skin or feathers too far.');
    }
    if (detail >= 5) {
      edit.clarity = 0.2;
      notes.push('Micro-contrast clarity sharpens subject texture naturally.');
    }
  }

  if (!Object.values(edit).some((v) => typeof v === 'number' && Math.abs(v) >= 0.005)) {
    notes.push('This photo already looks balanced, so it is left as it is.');
  }
  return { edit, notes };
}

/** Merge studio suggestions cleanly into a PhotoEdit without clearing existing manual tweaks. */
export function mergeStudioSuggestion(current: PhotoEdit, suggestion: Partial<PhotoEdit>): { edit: PhotoEdit; changed: boolean } {
  const edit: PhotoEdit = { ...current };
  let changed = false;
  const numericKeys = ['exposure', 'warmth', 'tint', 'shadows', 'highlights', 'contrast', 'vibrance', 'clarity', 'sharpen'] as const;
  for (const key of numericKeys) {
    const value = suggestion[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0 || (current[key] ?? 0) === value) continue;
    edit[key] = value;
    changed = true;
  }
  return { edit, changed };
}

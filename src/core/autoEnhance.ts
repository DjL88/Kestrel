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

  // Exposure: aim the median at a comfortable perceptual level without pushing highlights out.
  const median = at(0.5);
  const medianTone = toPerceptual(median);
  // Leave a comfortable band alone, and otherwise move toward its nearer edge.
  const goal = medianTone < 0.38 ? 0.42 : medianTone > 0.6 ? 0.56 : medianTone;
  let gain = clamp((goal ** 2.2) / Math.max(median, 0.002), 0.35, 4);
  const p99 = at(0.99);
  if (gain > 1 && p99 * gain > 1) gain = Math.max(1, 1 / Math.max(p99, 0.01));
  const exposure = clamp(round(Math.log2(gain) / 0.4), -1.5, 1.5);
  if (Math.abs(exposure) >= 0.1) {
    result.exposure = exposure;
    notes.push(exposure > 0 ? 'Photo is on the dark side, so exposure goes up.' : 'Photo is on the bright side, so exposure goes down.');
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
  if (after(at(0.95)) - lowTone < 0.5) {
    result.contrast = 0.5;
    notes.push('Tones are bunched together, so contrast goes up a little.');
  }
  if (chromaSum / count < 0.18) {
    result.vibrance = 0.5;
    notes.push('Colours are muted, so vibrance goes up. Saturation is untouched.');
  }
  return { edit: result, notes };
}

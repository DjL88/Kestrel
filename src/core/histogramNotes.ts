import type { Histogram } from './histogram';

export interface HistogramNote {
  /** Which note this is, so the interface can word it in any language. */
  id: 'whiteClip' | 'blackClip' | 'dark' | 'bright' | 'bunched' | 'warm' | 'cool' | 'spread';
  /** The share of the picture the headline names, formatted, when it names one. */
  share?: string;
  /** One short sentence about what the histogram shows. */
  headline: string;
  /** What that means, in plain words. */
  meaning: string;
  /** One thing to try, naming the slider. */
  tryThis: string;
  /** Whether it is something to fix, or just something to know. */
  tone: 'good' | 'info' | 'watch';
}

export function histogramSummary(h: Histogram) {
  const total = Math.max(1, h.pixels);
  let sum = 0;
  let shadows = 0;
  let highlights = 0;
  for (let i = 0; i < 256; i += 1) {
    sum += i * h.luma[i];
    if (i < 64) shadows += h.luma[i];
    if (i >= 192) highlights += h.luma[i];
  }
  const percentile = (share: number) => {
    let seen = 0;
    for (let i = 0; i < 256; i += 1) {
      seen += h.luma[i];
      if (seen >= total * share) return i / 255;
    }
    return 1;
  };
  const channelMean = (bins: Uint32Array) => bins.reduce((acc, count, i) => acc + i * count, 0) / total / 255;
  return {
    mean: sum / total / 255, shadows: shadows / total, highlights: highlights / total,
    low: percentile(0.05), high: percentile(0.95),
    red: channelMean(h.red), blue: channelMean(h.blue),
  };
}

const percent = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

/**
 * Explain a histogram in plain English for someone learning photography. The first note is the most important one.
 * These are rules of thumb, not rules: a dark, moody photo can be exactly what you wanted, and the notes say so.
 */
export function interpretHistogram(h: Histogram): HistogramNote[] {
  if (h.pixels < 100) return [];
  const s = histogramSummary(h);
  const notes: HistogramNote[] = [];

  if (h.highlightClip > 0.01) {
    notes.push({
      id: 'whiteClip', share: percent(h.highlightClip), tone: 'watch', headline: `${percent(h.highlightClip)} of the picture is pure white`,
      meaning: 'Pure white holds no detail, such as the feathers on a pale bird or bright sky. Once it is gone, it cannot be brought back from a JPEG.',
      tryThis: 'Lower Highlights or Whites, or lower Light a little.',
    });
  }
  if (h.shadowClip > 0.02) {
    notes.push({
      id: 'blackClip', share: percent(h.shadowClip), tone: 'watch', headline: `${percent(h.shadowClip)} of the picture is pure black`,
      meaning: 'Pure black holds no detail, so dark fur or a shaded face becomes a flat patch.',
      tryThis: 'Raise Shadows or Blacks, or raise Light a little.',
    });
  }

  if (s.mean < 0.3 && s.shadows > 0.55) {
    notes.push({
      id: 'dark', tone: 'info', headline: 'Most of the picture is dark',
      meaning: 'The graph is piled up on the left. That is right for a moody, low-key photo, but if you wanted a bright subject it is underexposed.',
      tryThis: 'Raise Light or Shadows. Raising too far makes noise show.',
    });
  } else if (s.mean > 0.68 && s.highlights > 0.5) {
    notes.push({
      id: 'bright', tone: 'info', headline: 'Most of the picture is bright',
      meaning: 'The graph is piled up on the right. That suits a light, airy, high-key photo, but if it feels washed out it is overexposed.',
      tryThis: 'Lower Light or Highlights.',
    });
  } else if (s.high - s.low < 0.4) {
    notes.push({
      id: 'bunched', tone: 'info', headline: 'The tones are bunched together',
      meaning: 'The graph is a narrow hill in the middle with empty space either side, so there is no true black or white. The picture can look flat or hazy.',
      tryThis: 'Raise Contrast, or lower Blacks and raise Whites a little.',
    });
  }

  const cast = s.red - s.blue;
  if (cast > 0.1) {
    notes.push({
      id: 'warm', tone: 'info', headline: 'There is more red than blue',
      meaning: 'Warm light such as sunrise, sunset or golden hour does this on purpose. If the whites look orange when they should be neutral, the white balance is too warm.',
      tryThis: 'Lower Warmth if you want it more neutral.',
    });
  } else if (cast < -0.1) {
    notes.push({
      id: 'cool', tone: 'info', headline: 'There is more blue than red',
      meaning: 'Shade, overcast skies and open sky are cool. If whites look blue when they should be neutral, the white balance is too cool.',
      tryThis: 'Raise Warmth if you want it more neutral.',
    });
  }

  if (!notes.length) {
    notes.push({
      id: 'spread', tone: 'good', headline: 'The tones are well spread',
      meaning: 'The graph reaches from dark to bright without piling up at either end, which gives you room to edit and keeps detail in the shadows and highlights.',
      tryThis: 'Nothing needed. Fine-tune by eye.',
    });
  }
  return notes.slice(0, 3);
}

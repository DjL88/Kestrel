import { computeHistogram, computeHistogram16, histogramBars, type Histogram } from '../../core/histogram';
import type { PhotoHistogram } from '../ui/contract';

const BINS = 32;

function toBars(histogram: Histogram): PhotoHistogram {
  const scale = (bins: Uint32Array) => histogramBars(bins, BINS).map((value) => Math.round(value * 100));
  const clip = (bins: Uint32Array, top: number) => ({
    shadow: histogram.pixels ? bins[0] / histogram.pixels : 0,
    highlight: histogram.pixels ? top / histogram.pixels : 0,
  });
  return {
    luma: scale(histogram.luma), red: scale(histogram.red), green: scale(histogram.green), blue: scale(histogram.blue),
    shadowClip: histogram.shadowClip, highlightClip: histogram.highlightClip,
    channelClip: { red: clip(histogram.red, histogram.red[255]), green: clip(histogram.green, histogram.green[255]), blue: clip(histogram.blue, histogram.blue[255]) },
  };
}

/** A real histogram from the pixels of the picture as it is now (with its edit), in the 32 bins of 0 to 100 the interface
 * draws. Clipping is the share of pixels at pure black or pure white in any channel. Measured, never estimated. */
export function toPhotoHistogram(data: Uint8ClampedArray): PhotoHistogram {
  return toBars(computeHistogram(data));
}

/** The same from the 16-bit RAW develop (three samples per pixel). Clipping counts only the true 16-bit ends. */
export function toPhotoHistogram16(data: Uint16Array): PhotoHistogram {
  const histogram = computeHistogram16(data);
  const ends = { red: [0, 0], green: [0, 0], blue: [0, 0] } as Record<'red' | 'green' | 'blue', [number, number]>;
  const pixels = Math.floor(data.length / 3);
  for (let i = 0; i < pixels * 3; i += 3) {
    (['red', 'green', 'blue'] as const).forEach((channel, c) => {
      const value = data[i + c];
      if (value === 0) ends[channel][0] += 1;
      else if (value === 65535) ends[channel][1] += 1;
    });
  }
  const bars = toBars(histogram);
  const share = (n: number) => (pixels ? n / pixels : 0);
  return {
    ...bars,
    channelClip: {
      red: { shadow: share(ends.red[0]), highlight: share(ends.red[1]) },
      green: { shadow: share(ends.green[0]), highlight: share(ends.green[1]) },
      blue: { shadow: share(ends.blue[0]), highlight: share(ends.blue[1]) },
    },
    precision: 'rgb16',
  };
}

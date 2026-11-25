import { computeHistogram, histogramBars } from '../../core/histogram';
import type { PhotoHistogram } from '../ui/contract';

const BINS = 32;

/** A real histogram from the pixels of the picture as it is now (with its edit), in the 32 bins of 0 to 100 the interface
 * draws. Clipping is the share of pixels at pure black or pure white in any channel. Measured, never estimated. */
export function toPhotoHistogram(data: Uint8ClampedArray): PhotoHistogram {
  const histogram = computeHistogram(data);
  const scale = (bins: Uint32Array) => histogramBars(bins, BINS).map((value) => Math.round(value * 100));
  const clip = (bins: Uint32Array) => ({
    shadow: histogram.pixels ? bins[0] / histogram.pixels : 0,
    highlight: histogram.pixels ? bins[255] / histogram.pixels : 0,
  });
  return {
    luma: scale(histogram.luma), red: scale(histogram.red), green: scale(histogram.green), blue: scale(histogram.blue),
    shadowClip: histogram.shadowClip, highlightClip: histogram.highlightClip,
    channelClip: { red: clip(histogram.red), green: clip(histogram.green), blue: clip(histogram.blue) },
  };
}

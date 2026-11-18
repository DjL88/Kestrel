/**
 * Real-time Highlight & Shadow Clipping Diagnostics ("Blinkies").
 * Evaluates display-encoded RGBA buffers and paints non-blocking warning pixels:
 * - Pure white clip (all channels >= 254): ruby red (#ef4444)
 * - Deep shadow crush (all channels <= 1): cobalt blue (#3b82f6)
 * - Single-channel saturation clip (peak >= 254, not white): warm amber (#f59e0b)
 */

export interface ClippingSummary {
  highlightPixels: number;
  shadowPixels: number;
  channelPixels: number;
  totalPixels: number;
}

export function computeClippingOverlay(
  sourceRgba: Uint8ClampedArray,
  overlayOut?: Uint8ClampedArray,
): ClippingSummary {
  const count = Math.floor(sourceRgba.length / 4);
  let highlightPixels = 0;
  let shadowPixels = 0;
  let channelPixels = 0;

  for (let i = 0; i < count; i += 1) {
    const j = i * 4;
    const r = sourceRgba[j];
    const g = sourceRgba[j + 1];
    const b = sourceRgba[j + 2];

    if (r >= 254 && g >= 254 && b >= 254) {
      highlightPixels += 1;
      if (overlayOut) {
        overlayOut[j] = 239;
        overlayOut[j + 1] = 68;
        overlayOut[j + 2] = 68;
        overlayOut[j + 3] = 225;
      }
    } else if (r <= 1 && g <= 1 && b <= 1) {
      shadowPixels += 1;
      if (overlayOut) {
        overlayOut[j] = 59;
        overlayOut[j + 1] = 130;
        overlayOut[j + 2] = 246;
        overlayOut[j + 3] = 220;
      }
    } else if (r >= 254 || g >= 254 || b >= 254) {
      channelPixels += 1;
      if (overlayOut) {
        overlayOut[j] = 245;
        overlayOut[j + 1] = 158;
        overlayOut[j + 2] = 11;
        overlayOut[j + 3] = 135;
      }
    } else if (overlayOut) {
      overlayOut[j] = 0;
      overlayOut[j + 1] = 0;
      overlayOut[j + 2] = 0;
      overlayOut[j + 3] = 0;
    }
  }
  return { highlightPixels, shadowPixels, channelPixels, totalPixels: count };
}

/**
 * Work out how to turn a developed RAW picture so it matches the camera's own preview. The preview is stored the way
 * the camera showed it; the sensor data is not, and some cameras' rotation flags are missing or say "normal" for a photo
 * taken upright-portrait. Comparing small greyscale copies tells which way round is right, whatever the flag says.
 */
export const THUMB = 32;
export type Turn = 0 | 90 | 180 | 270;

/** A THUMB x THUMB greyscale copy of a picture, row by row. */
export type Thumb = Float32Array;

/** Turn a square thumbnail clockwise by 0, 90, 180 or 270 degrees. */
export function turnThumb(thumb: Thumb, turn: Turn): Thumb {
  const out = new Float32Array(THUMB * THUMB);
  for (let y = 0; y < THUMB; y += 1) {
    for (let x = 0; x < THUMB; x += 1) {
      const [nx, ny] = turn === 0 ? [x, y] : turn === 90 ? [THUMB - 1 - y, x] : turn === 180 ? [THUMB - 1 - x, THUMB - 1 - y] : [y, THUMB - 1 - x];
      out[ny * THUMB + nx] = thumb[y * THUMB + x];
    }
  }
  return out;
}

/** Average brightness difference between two thumbnails after removing each one's overall brightness. 0 is identical. */
export function thumbDifference(a: Thumb, b: Thumb): number {
  const mean = (t: Thumb) => t.reduce((sum, v) => sum + v, 0) / t.length;
  const ma = mean(a), mb = mean(b);
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - ma - (b[i] - mb));
  return total / a.length;
}

/**
 * Which turn (clockwise) makes the developed picture look like the preview. Pictures of different shape (one portrait,
 * one landscape) can suggest a quarter-turn; pictures of the same shape can suggest a half-turn. Change the native
 * orientation only when the image content clearly supports the turn.
 */
export function bestTurn(
  preview: { thumb: Thumb; portrait: boolean },
  developed: { thumb: Thumb; portrait: boolean },
): Turn {
  const same = preview.portrait === developed.portrait;
  const options: Turn[] = same ? [0, 180] : [90, 270];
  const scored = options.map((turn) => ({ turn, error: thumbDifference(preview.thumb, turnThumb(developed.thumb, turn)) }));
  scored.sort((a, b) => a.error - b.error);
  const [best, other] = scored;
  if (same) return best.turn === 180 && best.error < other.error * 0.8 ? 180 : 0;
  // An embedded preview can be cropped differently. Require a clear match over
  // both the other quarter-turn and the decoder's unchanged orientation.
  const unchangedError = thumbDifference(preview.thumb, developed.thumb);
  return best.error < Math.min(other.error, unchangedError) * 0.8 ? best.turn : 0;
}

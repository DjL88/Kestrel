/** Offline, deliberately conservative guard for unattended Auto Develop.
 * These are observable RGB preview limits, NOT aesthetic or RAW-colour proof.
 * A failed gate leaves the photo unchanged and keeps the Auto preview available.
 */
export interface AutoQualityAssessment { safe: boolean; reason: string }
const safe = (): AutoQualityAssessment => ({ safe: true, reason: 'Within preview clipping and colour limits' });
const blocked = (reason: string): AutoQualityAssessment => ({ safe: false, reason });

function clipped(data: Uint8ClampedArray) {
  let white = 0, channel = 0, black = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r === 255 && g === 255 && b === 255) white++;
    if (r === 255 || g === 255 || b === 255) channel++;
    if (r === 0 && g === 0 && b === 0) black++;
  }
  const pixels = data.length / 4;
  return { white: white / pixels, channel: channel / pixels, black: black / pixels };
}

function hue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (!delta) return 0;
  const h = max === r ? ((g - b) / delta) % 6 :
    max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return ((h * 60) + 360) % 360;
}

/** Clipping and large colour drift are unacceptable for unattended changes. */
export function assessAutoQuality(before: Uint8ClampedArray, after: Uint8ClampedArray): AutoQualityAssessment {
  if (!before.length || before.length % 4 !== 0 || after.length !== before.length) {
    return blocked('Preview dimensions are inconsistent');
  }
  const a = clipped(before), b = clipped(after);
  // A few newly clipped isolated pixels are tolerated; substantial losses are not.
  if (b.white > a.white + 0.005 && b.white > a.white * 1.15) return blocked('More pure-white clipping');
  if (b.channel > a.channel + 0.01 && b.channel > a.channel * 1.15) return blocked('More colour-channel clipping');
  if (b.black > a.black + 0.015 && b.black > a.black * 1.15) return blocked('More crushed black pixels');

  let vivid = 0, altered = 0;
  const count = before.length / 4;
  for (let i = 0; i < before.length; i += 4) {
    const r = before[i], g = before[i + 1], bl = before[i + 2];
    const high = Math.max(r, g, bl), low = Math.min(r, g, bl);
    if (high < 130 || high - low < 70) continue;
    vivid++;
    const nr = after[i], ng = after[i + 1], nb = after[i + 2];
    const nh = Math.max(nr, ng, nb), nl = Math.min(nr, ng, nb);
    // Unattended Auto should not radically re-colour vivid feathers, flowers or clothes.
    // A vivid feather can be ruined by desaturation or strong darkening
    // without clipping a channel or changing hue. Those must count as
    // colour failures too, not be silently skipped from the denominator.
    const afterChroma = nh - nl;
    if (nh < 60 || afterChroma < Math.max(25, (high - low) * 0.3)) {
      altered++;
      continue;
    }
    const difference = Math.abs(hue(r, g, bl) - hue(nr, ng, nb));
    if (Math.min(difference, 360 - difference) > 30) altered++;
  }
  // A distant kingfisher may occupy <3% of the frame. Protect even a small
  // meaningful patch, provided enough sampled pixels corroborate the change.
  if (vivid >= Math.max(12, Math.ceil(count * 0.001)) && altered > vivid * 0.1) {
    return blocked('Vivid feathers or other saturated colours changed too far');
  }
  return safe();
}

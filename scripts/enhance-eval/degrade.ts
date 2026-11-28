import type { Img } from './images';

/**
 * Known, synthetic flaws applied to a real photo's working preview. The original preview is the "truth", so recovery can be
 * measured objectively. These are labelled synthetic in every report; they are not a substitute for real flawed photographs.
 */
export type Flaw = 'dark' | 'blown' | 'warm' | 'cool' | 'flat' | 'noisy-dark';
export const FLAWS: readonly Flaw[] = ['dark', 'blown', 'warm', 'cool', 'flat', 'noisy-dark'];
export const FLAW_WORDS: Record<Flaw, string> = {
  dark: 'under-exposed by 1 EV', blown: 'over-exposed by 0.9 EV (highlights clip)', warm: 'warm colour cast', cool: 'cool colour cast',
  flat: 'flat, low contrast', 'noisy-dark': 'dark with high-ISO noise',
};

const toLin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toEnc = (l: number) => Math.round(255 * Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)));

/** Small deterministic generator so every run of the harness produces the same noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

export function degrade(img: Img, flaw: Flaw, seed = 1): Img {
  const out = new Uint8ClampedArray(img.rgba);
  const r = rng(seed);
  const gains: Record<Flaw, [number, number, number]> = {
    dark: [0.5, 0.5, 0.5], blown: [1.87, 1.87, 1.87], warm: [1.22, 1, 0.78], cool: [0.8, 1, 1.2], flat: [1, 1, 1], 'noisy-dark': [0.3, 0.3, 0.3],
  };
  const [gr, gg, gb] = gains[flaw];
  for (let i = 0; i < img.width * img.height; i += 1) {
    const o = i * 4;
    let rr = toEnc(toLin(img.rgba[o]) * gr), gg2 = toEnc(toLin(img.rgba[o + 1]) * gg), bb = toEnc(toLin(img.rgba[o + 2]) * gb);
    if (flaw === 'flat') { rr = 127 + (rr - 127) * 0.5; gg2 = 127 + (gg2 - 127) * 0.5; bb = 127 + (bb - 127) * 0.5; }
    if (flaw === 'noisy-dark') { const n = gauss(r) * 9; rr += n + gauss(r) * 3; gg2 += n + gauss(r) * 3; bb += n + gauss(r) * 3; }
    out[o] = rr; out[o + 1] = gg2; out[o + 2] = bb; out[o + 3] = 255;
  }
  return { rgba: out, width: img.width, height: img.height };
}

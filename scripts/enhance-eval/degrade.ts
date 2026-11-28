import type { Img } from './images';

/**
 * Known, synthetic flaws applied to a real photo's working preview. The original preview is the "truth", so recovery can be
 * measured objectively. These are labelled synthetic in every report; they are not a substitute for real flawed photographs.
 */
export type Flaw = 'dark' | 'blown' | 'warm' | 'cool' | 'flat' | 'noisy-dark' | 'under2' | 'lowkey';
export const FLAWS: readonly Flaw[] = ['dark', 'blown', 'warm', 'cool', 'flat', 'noisy-dark'];
/** Intent cases: truth is known by construction. 'under2' is genuinely underexposed; 'lowkey' is a lit centre in a dark scene. */
export const INTENT_FLAWS: readonly Flaw[] = ['under2', 'lowkey'];
export const FLAW_WORDS: Record<Flaw, string> = {
  dark: 'under-exposed by 1 EV', blown: 'over-exposed by 0.9 EV (highlights clip)', warm: 'warm colour cast', cool: 'cool colour cast',
  flat: 'flat, low contrast', 'noisy-dark': 'dark with high-ISO noise', under2: 'genuinely under-exposed by 1.7 EV', lowkey: 'deliberately low key (lit centre, dark surround)',
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
    dark: [0.5, 0.5, 0.5], blown: [1.87, 1.87, 1.87], warm: [1.22, 1, 0.78], cool: [0.8, 1, 1.2], flat: [1, 1, 1], 'noisy-dark': [0.3, 0.3, 0.3], under2: [0.3, 0.3, 0.3], lowkey: [1, 1, 1],
  };
  const [gr, gg, gb] = gains[flaw];
  for (let i = 0; i < img.width * img.height; i += 1) {
    const o = i * 4;
    let gain = 1;
    if (flaw === 'lowkey') {
      const dx = (i % img.width) / img.width - 0.5, dy = Math.floor(i / img.width) / img.height - 0.5;
      const d = Math.hypot(dx / 0.28, dy / 0.3);
      gain = 0.06 + 0.94 * Math.min(1, Math.max(0, 1.4 - d)); // soft pool of light, near-black surround
    }
    let rr = toEnc(toLin(img.rgba[o]) * gr * gain), gg2 = toEnc(toLin(img.rgba[o + 1]) * gg * gain), bb = toEnc(toLin(img.rgba[o + 2]) * gb * gain);
    if (flaw === 'flat') { rr = 127 + (rr - 127) * 0.5; gg2 = 127 + (gg2 - 127) * 0.5; bb = 127 + (bb - 127) * 0.5; }
    if (flaw === 'noisy-dark') { const n = gauss(r) * 9; rr += n + gauss(r) * 3; gg2 += n + gauss(r) * 3; bb += n + gauss(r) * 3; }
    out[o] = rr; out[o + 1] = gg2; out[o + 2] = bb; out[o + 3] = 255;
  }
  return { rgba: out, width: img.width, height: img.height };
}

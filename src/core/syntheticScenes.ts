import type { SubjectGrid } from './maskTypes';

/**
 * Deterministic synthetic scenes that model the owner's three reference compositions without using their photographs.
 * They are test fixtures, not photographs: they reproduce the measurable properties that break automatic edits
 * (smooth bright bokeh, noisy dark foliage, rich warm plumage with fine texture, vivid green blur).
 */
export interface SyntheticScene {
  name: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  /** Ground-truth subject grid, as the on-device detector would produce it. */
  grid: SubjectGrid;
  /** True for subject pixels, for test measurements. */
  subject: Uint8Array;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());

function blobField(width: number, height: number, random: () => number, count: number, radius: number) {
  const blobs = Array.from({ length: count }, () => ({ x: random() * width, y: random() * height, r: radius * (0.5 + random()), a: random() }));
  return (x: number, y: number) => {
    let v = 0;
    for (const b of blobs) v += b.a * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.r * b.r));
    return Math.min(1, v);
  };
}

function gridFrom(subject: Uint8Array, width: number, height: number, w = 32, h = 24): SubjectGrid {
  const bytes = new Uint8Array(w * h);
  for (let gy = 0; gy < h; gy += 1) for (let gx = 0; gx < w; gx += 1) {
    let inside = 0, total = 0;
    for (let y = Math.floor((gy * height) / h); y < Math.floor(((gy + 1) * height) / h); y += 1) {
      for (let x = Math.floor((gx * width) / w); x < Math.floor(((gx + 1) * width) / w); x += 1) { inside += subject[y * width + x]; total += 1; }
    }
    bytes[gy * w + gx] = total ? Math.round((255 * inside) / total) : 0;
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return { w, h, data: btoa(binary) };
}

/** Fine feather texture: oriented barbs plus a little grain, amplitude in 8-bit codes. */
function feather(x: number, y: number, random: () => number, amplitude: number) {
  return amplitude * (0.6 * Math.sin((x * 0.9 + y * 0.35) * 1.7) + 0.4 * Math.sin((x * 0.2 - y * 1.1) * 1.3)) + gauss(random) * 2;
}

function build(name: string, width: number, height: number, seed: number,
  paint: (x: number, y: number, random: () => number) => { rgb: [number, number, number]; subject: boolean }): SyntheticScene {
  const random = rng(seed);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const subject = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const { rgb, subject: s } = paint(x, y, random);
    const i = (y * width + x) * 4;
    pixels[i] = rgb[0]; pixels[i + 1] = rgb[1]; pixels[i + 2] = rgb[2]; pixels[i + 3] = 255;
    subject[y * width + x] = s ? 1 : 0;
  }
  return { name, width, height, pixels, subject, grid: gridFrom(subject, width, height) };
}

/** Reference 2 (_DJL1296-like): robin on a railing, white sky and bright cream bokeh, warm orange breast. */
export function robinBrightBokeh(width = 320, height = 240): SyntheticScene {
  const bokeh = blobField(width, height, rng(11), 9, width * 0.09);
  return build('robin-bright-bokeh', width, height, 1296, (x, y, random) => {
    const cx = width * 0.5, cy = height * 0.52, rx = width * 0.13, ry = height * 0.2;
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d < 1) {
      const breast = y > cy - ry * 0.35 && Math.abs(x - cx) < rx * 0.75;
      const t = feather(x, y, random, breast ? 9 : 7);
      return { subject: true, rgb: breast ? [206 + t, 112 + t * 0.7, 52 + t * 0.4] : [118 + t, 92 + t, 70 + t] };
    }
    if (y > height * 0.8 && y < height * 0.86) return { subject: false, rgb: [128, 130, 134] };
    const sky = 244 + 9 * (1 - y / height);
    const b = bokeh(x, y), n = gauss(random) * 1.2;
    return { subject: false, rgb: [sky - 10 * b + n, sky - 8 * b + n, sky - 22 * b + n] };
  });
}

/** Reference 1 (_DSC0009-like): dark mottled bird on a log, noisy dark woodland, soft out-of-focus foreground leaves. */
export function woodlandDarkBird(width = 320, height = 240): SyntheticScene {
  const leaves = blobField(width, height, rng(29), 6, width * 0.08);
  const foliage = blobField(width, height, rng(31), 14, width * 0.06);
  return build('woodland-dark-bird', width, height, 9, (x, y, random) => {
    const cx = width * 0.55, cy = height * 0.45, rx = width * 0.12, ry = height * 0.16;
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    const grain = gauss(random) * 5;
    if (d < 1) {
      const t = feather(x, y, random, 8) + ((x * 7 + y * 3) % 11 < 3 ? 12 : 0);
      return { subject: true, rgb: [62 + t, 52 + t, 40 + t] };
    }
    if (y > cy + ry * 0.9 && y < cy + ry * 1.3) return { subject: false, rgb: [58 + grain, 44 + grain, 30 + grain] };
    const fg = leaves(x, y);
    if (fg > 0.55 && y > height * 0.6) return { subject: false, rgb: [22 + 8 * fg + grain, 40 + 14 * fg + grain, 18 + grain] };
    const f = foliage(x, y);
    return { subject: false, rgb: [14 + 18 * f + grain, 22 + 30 * f + grain, 12 + 12 * f + grain] };
  });
}

/** Reference 3 (_DJL3296-like): close robin with rich orange breast and smooth vivid green bokeh. */
export function closeRobinGreen(width = 320, height = 240): SyntheticScene {
  const glow = blobField(width, height, rng(47), 7, width * 0.12);
  return build('close-robin-green', width, height, 3296, (x, y, random) => {
    const cx = width * 0.46, cy = height * 0.55, rx = width * 0.24, ry = height * 0.36;
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d < 1) {
      const breast = y > cy - ry * 0.2 && Math.abs(x - cx) < rx * 0.7;
      const eye = Math.hypot(x - (cx + rx * 0.35), y - (cy - ry * 0.55)) < width * 0.012;
      if (eye) return { subject: true, rgb: Math.hypot(x - (cx + rx * 0.35) + 1, y - (cy - ry * 0.55) + 1) < 1.2 ? [235, 235, 230] : [14, 12, 10] };
      const t = feather(x, y, random, breast ? 10 : 8);
      return { subject: true, rgb: breast ? [214 + t, 104 + t * 0.7, 44 + t * 0.4] : [126 + t, 104 + t, 78 + t] };
    }
    const g = glow(x, y), n = gauss(random) * 1.5;
    return { subject: false, rgb: [52 + 40 * g + n, 120 + 60 * g + n, 40 + 20 * g + n] };
  });
}

/** A genuinely underexposed, flat, neutral frame with texture everywhere (should be lifted). */
export function underexposedFlat(width = 160, height = 120): SyntheticScene {
  return build('underexposed-flat', width, height, 5, (x, y, random) => {
    const v = 28 + feather(x, y, random, 6) + (x / width) * 10;
    return { subject: x > width * 0.3 && x < width * 0.7 && y > height * 0.3 && y < height * 0.7, rgb: [v, v, v + 1] };
  });
}

export const REFERENCE_SCENES = [robinBrightBokeh, woodlandDarkBird, closeRobinGreen] as const;

/**
 * A lit bird against a near-black background, with a few bright specks of splash (the owner's kingfisher frame, 27 Nov
 * 2026, without using it). `subjectLevel` is the bird's typical 8-bit level: about 50 is a dim bird that wants a lift,
 * about 130 one that is already well lit.
 */
export function darkBackgroundBird(subjectLevel = 50, width = 320, height = 240): SyntheticScene {
  return build('dark-background-bird', width, height, 41, (x, y, random) => {
    const cx = width * 0.5, cy = height * 0.5, rx = width * 0.16, ry = height * 0.2;
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d < 1) {
      const t = feather(x, y, random, 6);
      // Lit edges of the plumage: about a tenth of the bird is clearly brighter than the rest.
      const lit = (x * 5 + y * 3) % 10 === 0 ? 1.9 : 1;
      const upper = y < cy;
      return { subject: true, rgb: upper ? [subjectLevel * 0.55 * lit + t, subjectLevel * 0.95 * lit + t, subjectLevel * 1.35 * lit + t]
        : [subjectLevel * 1.45 * lit + t, subjectLevel * 0.9 * lit + t, subjectLevel * 0.45 * lit + t] };
    }
    // Splash: a few bright specks below the bird.
    if (y > cy + ry && y < cy + ry * 1.6 && (x * 13 + y * 7) % 97 === 0) return { subject: false, rgb: [215, 222, 228] };
    const grain = gauss(random) * 1.5;
    return { subject: false, rgb: [7 + grain, 9 + grain, 11 + grain] };
  });
}

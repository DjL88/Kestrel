import { maskAlpha, type MaskContext } from './masks';
import { LOCAL_DETAIL_KEYS, type Mask } from './maskTypes';
import { DETAIL_CONTROLS, type PhotoEdit } from './photoEdits';

export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

/** A change the opinion can make for the user. Values are added to the current slider values. */
export type Fix = { kind: 'global'; delta: Partial<Record<keyof PhotoEdit, number>> } | { kind: 'mask'; maskId: string; delta: Partial<Record<string, number>> };

export interface Opinion {
  id: string;
  severity: 'warning' | 'tip';
  title: string;
  detail: string;
  fix?: Fix;
  /** Words for the Apply button, such as "Lower sharpening". */
  fixLabel?: string;
}

const luma = (pixels: Pixels): Float32Array => {
  const out = new Float32Array(pixels.width * pixels.height);
  for (let i = 0; i < out.length; i += 1) out[i] = (0.2126 * pixels.data[i * 4] + 0.7152 * pixels.data[i * 4 + 1] + 0.0722 * pixels.data[i * 4 + 2]) / 255;
  return out;
}

/** Minimum and maximum of each pixel's neighbourhood, radius r. Edge pixels use what is available. */
function neighbourhood(l: Float32Array, w: number, h: number, r: number) {
  const lo = new Float32Array(l.length);
  const hi = new Float32Array(l.length);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let a = 1;
    let b = 0;
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      const v = l[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
      if (v < a) a = v;
      if (v > b) b = v;
    }
    lo[y * w + x] = a;
    hi[y * w + x] = b;
  }
  return { lo, hi };
}

/** Share of pixels pushed beyond the range of their surroundings. Ringing and halos show up as overshoot. */
export function overshoot(reference: Pixels, edited: Pixels, margin = 0.06): number {
  const a = luma(reference);
  const b = luma(edited);
  const { lo, hi } = neighbourhood(a, reference.width, reference.height, 2);
  let count = 0;
  for (let i = 0; i < b.length; i += 1) if (b[i] > hi[i] + margin || b[i] < lo[i] - margin) count += 1;
  return count / Math.max(1, b.length);
}

/** Noise in flat areas: the typical size of tiny pixel-to-pixel differences where the picture is smooth. */
export function flatNoise(pixels: Pixels): number {
  const l = luma(pixels);
  const { width: w, height: h } = pixels;
  const diffs: number[] = [];
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const i = y * w + x;
    const around = (l[i - 1] + l[i + 1] + l[i - w] + l[i + w]) / 4;
    const gradient = Math.abs(l[i + 1] - l[i - 1]) + Math.abs(l[i + w] - l[i - w]);
    if (gradient < 0.05) diffs.push(Math.abs(l[i] - around));
  }
  if (diffs.length < 50) return 0;
  diffs.sort((p, q) => p - q);
  return diffs[Math.floor(diffs.length / 2)];
}

const clipFractions = (pixels: Pixels) => {
  let dark = 0;
  let white = 0;
  let channel = 0;
  const count = pixels.width * pixels.height;
  for (let i = 0; i < count; i += 1) {
    const r = pixels.data[i * 4];
    const g = pixels.data[i * 4 + 1];
    const b = pixels.data[i * 4 + 2];
    if (r === 0 || g === 0 || b === 0) dark += 1;
    // Pure white requires ALL channels. A saturated orange feather with R=255
    // has channel clipping, but it is not pure white and must not be described as such.
    if (r === 255 && g === 255 && b === 255) white += 1;
    if (r === 255 || g === 255 || b === 255) channel += 1;
  }
  return {
    shadows: dark / Math.max(1, count),
    highlights: white / Math.max(1, count),
    channels: channel / Math.max(1, count),
  };
};

const percent = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

export interface CritiqueInput {
  /** The photo as it was shot, at the crop being edited. */
  source: Pixels;
  /** The edit with its sharpening, texture and clarity left out. */
  toneOnly: Pixels;
  /** The finished edit. */
  after: Pixels;
  edit: PhotoEdit;
  /** Where the subject mask sits, when the photo has one. */
  subject?: { mask: Mask; context: MaskContext };
}

/** Local, rule-based opinions about an edit. No network and no generative model. At most four, most serious first. */
export function critique({ source, toneOnly, after, edit, subject }: CritiqueInput): Opinion[] {
  const found: Opinion[] = [];
  const detailOn = DETAIL_CONTROLS.some(({ key }) => (edit[key] ?? 0) > 0) ||
    !!edit.masks?.some((mask) => LOCAL_DETAIL_KEYS.some((key) => (mask.edit[key] ?? 0) > 0));

  // Sharpening, clarity or texture that has pushed pixels past their surroundings leaves halos.
  const halos = detailOn ? overshoot(toneOnly, after) : 0;
  if (halos > 0.04) {
    found.push({
      id: 'halos', severity: 'warning', title: 'Sharpening looks heavy',
      detail: `About ${percent(halos)} of the picture has bright or dark halos along edges, which usually means sharpening, clarity or texture is too strong.`,
      fix: { kind: 'global', delta: { sharpen: -0.4, clarity: -0.3, texture: -0.2 } }, fixLabel: 'Ease off sharpening',
    });
  }

  const clip = clipFractions(after);
  const before = clipFractions(source);
  if (clip.highlights > 0.015 && clip.highlights > before.highlights + 0.005) {
    found.push({
      id: 'highlights', severity: 'warning', title: 'Pure white areas have increased',
      detail: `${percent(clip.highlights)} of the preview has all three colour channels at maximum, compared with ${percent(before.highlights)} before editing. Check important highlights at 100%. Darkening the result cannot recover detail that was already clipped.`,
      // Do not offer an unvalidated global fix. On brightly coloured feathers,
      // pulling Highlights and Whites can make the subject dull without restoring data.
    });
  } else if (clip.channels > 0.015 && clip.channels > before.channels + 0.005) {
    found.push({
      id: 'colour-channels', severity: 'warning', title: 'Bright colours may be clipping',
      detail: `${percent(clip.channels)} of the preview has at least one colour channel at maximum, compared with ${percent(before.channels)} before editing. This does not mean those pixels are pure white. Check saturated feathers, lights and other important colours at 100% before changing global highlights.`,
    });
  }
  if (clip.shadows > 0.02 && clip.shadows > before.shadows + 0.005) {
    found.push({
      id: 'shadows', severity: 'warning', title: 'Shadows are crushed',
      detail: `${percent(clip.shadows)} of the picture is pure black, so detail there is lost. It was ${percent(before.shadows)} before your edit.`,
      fix: { kind: 'global', delta: { shadows: 0.4, blacks: 0.3 } }, fixLabel: 'Lift shadows',
    });
  }

  // Lifting shadows or adding detail can amplify noise in smooth areas.
  const noiseBefore = flatNoise(source);
  const noiseAfter = flatNoise(after);
  if (noiseBefore > 0 && noiseAfter > noiseBefore * 1.8 && noiseAfter > 0.008) {
    found.push({
      id: 'noise', severity: 'warning', title: 'The edit is amplifying noise',
      detail: `Grain in smooth areas is about ${(noiseAfter / noiseBefore).toFixed(1)} times what it was in the original. Strong shadow lifts, clarity and texture do this.`,
      fix: { kind: 'global', delta: { shadows: -0.3, clarity: -0.3, texture: -0.3 } }, fixLabel: 'Reduce the noise boost',
    });
  }

  // A subject that is much darker than its surroundings is often the thing to lift.
  if (subject) {
    const { width, height } = after;
    const alpha = maskAlpha({ ...subject.mask, invert: false } as Mask, width, height, subject.context);
    const l = luma(after);
    let inside = 0;
    let outside = 0;
    let insideWeight = 0;
    let outsideWeight = 0;
    for (let i = 0; i < l.length; i += 1) {
      inside += l[i] * alpha[i];
      insideWeight += alpha[i];
      outside += l[i] * (1 - alpha[i]);
      outsideWeight += 1 - alpha[i];
    }
    if (insideWeight > l.length * 0.02 && outsideWeight > l.length * 0.02) {
      const gap = outside / outsideWeight - inside / insideWeight;
      if (gap > 0.18) {
        found.push({
          id: 'subject-dark', severity: 'tip', title: 'Your subject is darker than its surroundings',
          detail: `The subject averages ${Math.round(gap * 100)} points darker than everything around it, so the eye may go to the background first.`,
          fix: { kind: 'mask', maskId: subject.mask.id, delta: { exposure: 0.5, shadows: 0.2 } }, fixLabel: 'Lift the subject',
        });
      } else if (gap < -0.25) {
        found.push({
          id: 'subject-bright', severity: 'tip', title: 'Your subject is much brighter than its surroundings',
          detail: `The subject averages ${Math.round(-gap * 100)} points brighter than the background, which can look pasted on.`,
          fix: { kind: 'mask', maskId: subject.mask.id, delta: { exposure: -0.3 } }, fixLabel: 'Tone the subject down',
        });
      }
    }
  }

  // Overall tone and colour.
  const l = luma(after);
  const sorted = Float32Array.from(l).sort();
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  if (p95 - p5 < 0.4 && found.every((o) => o.id !== 'highlights' && o.id !== 'shadows')) {
    found.push({
      id: 'flat', severity: 'tip', title: 'Tones are bunched together',
      detail: 'Almost all the picture sits in a narrow band of brightness, so it may look flat.',
      fix: { kind: 'global', delta: { contrast: 0.3, blacks: -0.2 } }, fixLabel: 'Add contrast',
    });
  }
  let strong = 0;
  let counted = 0;
  for (let i = 0; i < l.length; i += 1) {
    if (l[i] < 0.1) continue;
    const r = after.data[i * 4];
    const g = after.data[i * 4 + 1];
    const b = after.data[i * 4 + 2];
    const high = Math.max(r, g, b);
    counted += 1;
    if (high > 0 && (high - Math.min(r, g, b)) / high > 0.75) strong += 1;
  }
  if (counted > 0 && strong / counted > 0.25) {
    found.push({
      id: 'colour', severity: 'tip', title: 'Colours are very strong',
      detail: `${percent(strong / counted)} of the picture is intensely saturated, which can look unnatural and print badly.`,
      fix: { kind: 'global', delta: { colour: -0.4, vibrance: -0.3 } }, fixLabel: 'Soften colour',
    });
  }

  const rank = (opinion: Opinion) => (opinion.severity === 'warning' ? 0 : 1);
  return found.sort((a, b) => rank(a) - rank(b)).slice(0, 4);
}

/** Add a fix to the edit. Sliders stay within their range, and sharpening never goes below zero. */
export function applyFix(edit: PhotoEdit, fix: Fix): PhotoEdit {
  const limit = (key: string, value: number) => Math.max(key === 'sharpen' ? 0 : -2, Math.min(2, Math.round(value * 100) / 100));
  if (fix.kind === 'global') {
    const next: Record<string, number | Mask[] | undefined> = { ...edit };
    for (const [key, change] of Object.entries(fix.delta)) {
      const current = typeof next[key] === 'number' ? (next[key] as number) : 0;
      next[key] = limit(key, current + (change ?? 0));
    }
    return next as unknown as PhotoEdit;
  }
  return {
    ...edit,
    masks: edit.masks?.map((mask) => {
      if (mask.id !== fix.maskId) return mask;
      const local: Record<string, number> = { ...mask.edit };
      for (const [key, change] of Object.entries(fix.delta)) local[key] = limit(key, (local[key] ?? 0) + (change ?? 0));
      return { ...mask, edit: local };
    }),
  };
}

/** The same edit with sharpening, texture and clarity left out, everywhere. Used to tell tone changes from detail changes. */
export function toneOnlyEdit(edit: PhotoEdit): PhotoEdit {
  return {
    ...edit, texture: 0, clarity: 0, sharpen: 0,
    masks: edit.masks?.map((mask) => ({
      ...mask,
      edit: Object.fromEntries(Object.entries(mask.edit).filter(([key]) => !(LOCAL_DETAIL_KEYS as readonly string[]).includes(key))),
    })) as Mask[] | undefined,
  };
}

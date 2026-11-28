import type { PhotoEdit } from './photoEdits';
import { renderRecipePreview } from './naturalAuto';

/**
 * The highlight guard for Auto's lift. A lift that rescues a dark subject can blow a bright sky or background, so the
 * lifted RENDER is measured (the same clipping the histogram and the clipped-areas overlay count) and Auto's recipe is
 * only kept when the clipped area did not grow beyond a small tolerance. When it does grow, three bounded steps are
 * tried in order, each re-measured:
 *   1. pull the highlights and whites down (range compression), a little at a time;
 *   2. lift the dark ZONE (the Shadows slider) instead of the whole frame, for a dark subject on a bright background;
 *   3. lift less (a smaller exposure step), down to no lift.
 * If nothing satisfies the tolerance the recipe with the least clipping is returned and `satisfied` is false, so the
 * caller can say so rather than apply a blown result. Pure: nothing here edits a photo.
 */

/** Clipped area (share of the frame) Auto may add to the unedited render: 0.5 percentage points of pure white, 1 of near white. */
export const CLIP_TOLERANCE = 0.005;
export const NEAR_CLIP_TOLERANCE = 0.01;
const NEAR_WHITE = 250;
/** A pixel is clipped white only when ALL three channels are at the limit; one maxed channel is a saturated colour (an orange bird, a yellow bill), not blown light. */
const PURE_WHITE = 254;

export type GuardAction = 'none' | 'recovered' | 'zoned' | 'lifted-less' | 'unsatisfied';

export interface GuardResult {
  edit: PhotoEdit;
  action: GuardAction;
  /** Clipped shares (0 to 1) of the render before Auto, of Auto's first proposal and of the returned recipe. */
  clipBefore: number;
  clipProposal: number;
  clipAfter: number;
  /** True when the returned recipe is inside the tolerance. */
  satisfied: boolean;
}

interface Shares { pure: number; near: number }

function sharesOf(data: Uint8ClampedArray, width: number, height: number): Shares {
  let pure = 0, near = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r >= PURE_WHITE && g >= PURE_WHITE && b >= PURE_WHITE) pure += 1;
    // Near white is judged on luminance, so a saturated colour with one bright channel does not count.
    if (0.2126 * r + 0.7152 * g + 0.0722 * b >= NEAR_WHITE) near += 1;
  }
  const n = Math.max(1, width * height);
  return { pure: pure / n, near: near / n };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function guardHighlights(input: {
  pixels: Uint8ClampedArray; width: number; height: number; base: PhotoEdit; proposal: PhotoEdit;
}): GuardResult {
  const { pixels, width, height, base, proposal } = input;
  const before = sharesOf(renderRecipePreview(pixels, width, height, base), width, height);
  const measure = (edit: PhotoEdit): Shares => sharesOf(renderRecipePreview(pixels, width, height, edit), width, height);
  const excess = (s: Shares) => Math.max(s.pure - before.pure - CLIP_TOLERANCE, (s.near - before.near - NEAR_CLIP_TOLERANCE) * 0.5, 0);
  const result = (edit: PhotoEdit, action: GuardAction, shares: Shares, first: Shares): GuardResult => ({
    edit, action, clipBefore: before.pure, clipProposal: first.pure, clipAfter: shares.pure, satisfied: excess(shares) === 0,
  });
  const first = measure(proposal);
  if (excess(first) === 0) return result(proposal, 'none', first, first);

  let best: { edit: PhotoEdit; action: GuardAction; shares: Shares } = { edit: proposal, action: 'unsatisfied', shares: first };
  const consider = (edit: PhotoEdit, action: GuardAction): boolean => {
    const shares = measure(edit);
    if (excess(shares) === 0) { best = { edit, action, shares }; return true; }
    if (excess(shares) < excess(best.shares)) best = { edit, action: 'unsatisfied', shares };
    return false;
  };
  const baseExposure = base.exposure ?? 0;
  const lift = (proposal.exposure ?? 0) - baseExposure;

  // 1. Bounded range compression: highlights, then whites, never below what the person already had by more than the bound.
  for (const [highlights, whites] of [[-0.3, 0], [-0.6, -0.2], [-0.9, -0.4], [-1.2, -0.6]] as const) {
    const edit: PhotoEdit = { ...proposal, highlights: round(Math.min(proposal.highlights ?? 0, (base.highlights ?? 0) + highlights)),
      whites: round(Math.min(proposal.whites ?? 0, (base.whites ?? 0) + whites)) };
    if (consider(edit, 'recovered')) return result(best.edit, best.action, best.shares, first);
  }
  // 2. Lift the dark zone, not the whole frame: half the exposure lift moves to Shadows, with the compression kept.
  if (lift > 0) {
    for (const keep of [0.5, 0.25, 0]) {
      const edit: PhotoEdit = { ...proposal, exposure: round(baseExposure + lift * keep),
        shadows: round(Math.min(1.4, Math.max(proposal.shadows ?? 0, (base.shadows ?? 0) + lift * (1 - keep) * 0.8))),
        highlights: round(Math.min(proposal.highlights ?? 0, (base.highlights ?? 0) - 0.6)),
        whites: round(Math.min(proposal.whites ?? 0, (base.whites ?? 0) - 0.2)) };
      if (consider(edit, 'zoned')) return result(best.edit, best.action, best.shares, first);
    }
    // 3. Lift less.
    for (const keep of [0.75, 0.5, 0.25, 0]) {
      const edit: PhotoEdit = { ...proposal, exposure: round(baseExposure + lift * keep) };
      if (consider(edit, 'lifted-less')) return result(best.edit, best.action, best.shares, first);
    }
  }
  return result(best.edit, 'unsatisfied', best.shares, first);
}

/**
 * What is left of a recipe when the guard cannot make the lift safe: ONLY the lift is taken out (exposure, shadows and the
 * exposure or shadows of masks Auto added), so warmth, vibrance, highlight and contrast fixes that have nothing to do with
 * the lift are kept.
 */
export function withoutLift(base: PhotoEdit, proposal: PhotoEdit): PhotoEdit {
  const out: PhotoEdit = { ...proposal, exposure: base.exposure ?? 0 };
  if (base.shadows === undefined) delete out.shadows; else out.shadows = base.shadows;
  const baseIds = new Set((base.masks ?? []).map((mask) => mask.id));
  if (proposal.masks) {
    out.masks = proposal.masks.map((mask) => {
      if (baseIds.has(mask.id)) return mask;
      const { exposure: _exposure, shadows: _shadows, ...rest } = mask.edit;
      return { ...mask, edit: rest };
    }).filter((mask) => baseIds.has(mask.id) || Object.keys(mask.edit).length > 0);
    if (!out.masks.length) delete out.masks;
  }
  return out;
}

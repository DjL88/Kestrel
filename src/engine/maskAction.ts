import type { Mask, LocalEdit } from '../core/maskTypes';
import type { Pixels } from '../core/colourCheck';
import { verifyEdit, type CourseCorrection } from './enhancementVerifier';
import { runEngineTask } from './taskManager';

/**
 * Masking as a real, verified, retryable engine action - the same decide→render→verify→retry discipline
 * `denoiseAction.ts` gives a single capability, generalised to a list of masks (`EngineCapability`'s
 * `'mask'`, previously named only for `observedMaskProposal.ts`'s narrower anatomy-correction tool).
 *
 * This does not invent new mask maths: rendering a mask's effect, including one mask limited by another
 * (`Mask.limit`, intersect or subtract), already ships in `masks.ts`'s `effectiveAlpha`/`applyMasks` -
 * Lightroom-style mask combination is not a gap in the core pipeline, only in how the engine closes the
 * loop around it. What this module adds: deciding whether a mask's edit strength held up against the
 * same honesty checks every other action uses (no implausible brightness jump, no net detail loss - or,
 * with a subject alpha given, judged only inside the subject so a mask that deliberately alters the
 * background isn't penalised for it), and retrying every mask's edit at a reduced strength together if
 * it didn't - never changing a mask's shape, feather or limit, only how hard its `edit` pushes.
 */

export interface MaskActionInput {
  /** The masks to render, in the same order and shape `PhotoEdit.masks` stores them - including any
   * `limit` (intersect/subtract against another mask in this same list, set by `combineMasks` below or
   * by hand). This action does not reorder, merge or validate shapes; `core/maskTypes.ts`'s `validMasks`
   * is the place for that, before a mask reaches here. */
  masks: Mask[];
  /** Renders the photo with exactly these masks applied (background edit unchanged - masks carry their
   * own `edit`). Injected deliberately, same convention as `denoiseAction.ts`/`upscaleAction.ts`: this
   * module has no canvas or renderer of its own. */
  render: (masks: Mask[]) => Promise<Pixels>;
  /** The photo before this action, for the closed-loop check. */
  original: Pixels;
  /** When given, the verify step judges only inside the subject - use this for a mask that targets the
   * subject (or is deliberately protecting it while another mask alters the background). Omit it for a
   * mask (or combination) that is meant to change the whole frame, such as a plain linear sky gradient. */
  subject?: { alpha: Float32Array };
  maxRetries?: number;
}

export interface MaskActionResult {
  masks: Mask[];
  verification: CourseCorrection;
  /** 1 means it passed on the first try. */
  attempts: number;
}

/** Scales every numeric field of a mask's `edit`, same idea as `looks.ts`'s `scaleLocalEdit` but kept
 * local here rather than imported - `LocalEdit` is already a plain `Partial<Record<LocalKey, number>>`,
 * so duplicating this handful of lines avoids making mask actions depend on the Looks module for an
 * unrelated reason. */
function scaleMaskEdit(edit: LocalEdit, scale: number): LocalEdit {
  const scaled: LocalEdit = {};
  for (const [key, value] of Object.entries(edit) as [keyof LocalEdit, number | undefined][]) {
    if (typeof value === 'number') scaled[key] = value * scale;
  }
  return scaled;
}

/** Runs a set of masks (any shape, any combination of `limit`) as a real, verified, retryable action. */
export async function runMaskAction(input: MaskActionInput): Promise<MaskActionResult> {
  return runEngineTask('mask', 'device', 'Applying masks', async () => {
    const maxRetries = input.maxRetries ?? 2;
    let masks = input.masks;
    let verification: CourseCorrection = { ok: false, reasons: [], suggestedStrengthScale: 1 };
    let attempts = 0;

    for (; attempts <= maxRetries; attempts += 1) {
      const after = await input.render(masks);
      verification = verifyEdit(input.original, after, input.subject?.alpha, input.subject ? 'subject' : 'frame');
      if (verification.ok || attempts === maxRetries) break;
      masks = masks.map((mask) => ({ ...mask, edit: scaleMaskEdit(mask.edit, verification.suggestedStrengthScale) }));
    }
    return { masks, verification, attempts: attempts + 1 };
  });
}

/**
 * Limits `primary` by `limiter`'s own shape - intersect keeps only where both overlap, subtract keeps
 * everywhere `limiter` does NOT cover (Lightroom's "Intersect Mask"/"Subtract" on a second mask). Refuses
 * a mask limiting itself outright (`masks.ts`'s renderer would otherwise just ignore a self-reference -
 * see its own comment - but silently accepting one here would hide a caller's bug rather than surface
 * it, so this is the one validity check this module owns rather than leaving to the renderer).
 */
export function combineMasks(primary: Mask, limiterId: string, mode: 'intersect' | 'subtract'): Mask {
  if (limiterId === primary.id) {
    throw new Error('A mask cannot be limited by itself - choose a different mask to intersect or subtract.');
  }
  return { ...primary, limit: { id: limiterId, mode } };
}

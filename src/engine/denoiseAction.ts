import { createSubjectMask, type Mask, type SubjectGrid, type SubjectDetail } from '../core/maskTypes';
import type { Pixels } from '../core/colourCheck';
import type { PhotoEdit } from '../core/photoEdits';
import { verifyEdit, type CourseCorrection } from './enhancementVerifier';
import { regionalDetailEvidence } from './regionalDetailGuard';
import { runEngineTask } from './taskManager';
import { fullContext, maskAlpha } from '../core/masks';
import { chooseRegions, regionWeights, type DenoiseRegion, type RegionChoice } from '../core/trueDetailHybrid';

/**
 * Denoise as a real action, mask-aware (owner direction, 22 Nov 2026: "denoise within masking... sometimes
 * enhancing a subject is different to a background"). This does not invent new pixel maths: the per-mask
 * denoise blend already exists and ships today in `masks.ts`'s `applyMasks` (`local.denoise ?
 * applyNoiseReduction(...) : ...`, composited by the mask's own alpha). What was missing is deciding a
 * DIFFERENT strength for the subject than the background and closing the loop with `enhancementVerifier.ts`
 * - that is what this module adds.
 */

/** How much of the background's denoise strength the subject keeps by default. Lower = more subject detail
 * preserved relative to the background. A first-cut constant, not calibrated against real photos. */
export const SUBJECT_DENOISE_PROTECTION = 0.4;

export function splitDenoiseBySubject(
  backgroundDenoise: number,
  protection: number = SUBJECT_DENOISE_PROTECTION,
): { background: number; subject: number } {
  const background = Math.max(0, Math.min(2, backgroundDenoise));
  const clampedProtection = Math.max(0, Math.min(1, protection));
  return { background, subject: Math.round(background * clampedProtection * 1000) / 1000 };
}

/** A real `Mask` (reusing `createSubjectMask`) carrying its own, usually lower, denoise strength. */
export function subjectDenoiseMask(
  id: string, grid: SubjectGrid, framingKey: string, confidence: 'high' | 'medium' | 'low',
  subjectDenoise: number, detail?: SubjectDetail | null,
): Mask {
  const mask = createSubjectMask(id, grid, framingKey, confidence, detail);
  return { ...mask, edit: { ...mask.edit, denoise: subjectDenoise } };
}

export interface SubjectInput {
  maskId: string;
  grid: SubjectGrid;
  framingKey: string;
  confidence: 'high' | 'medium' | 'low';
  detail?: SubjectDetail | null;
  /** The subject's alpha (0-1 per pixel, same size as the render), so `enhancementVerifier.ts` can judge
   * subject colour separately from surroundings, same convention `checkColour` already uses. */
  alpha: Float32Array;
  /** Likely eyes inside the subject (centre 0 to 1 of the framed picture, radius in picture widths). Each gets the
   * gentlest denoise of all (TrueDetail eye protection). */
  eyes?: ReadonlyArray<{ x: number; y: number; radius: number }>;
}

export interface DenoiseActionInput {
  /** The requested background-facing strength (0-2, same range as `PhotoEdit.denoise`) - from a slider, an
   * AI-review proposal, or a future measured-noise signal; this module does not decide that number, only
   * how it is split and whether the result holds up. */
  backgroundDenoise: number;
  subject?: SubjectInput;
  /** Renders the photo with this edit + these masks applied. Injected deliberately: this module has no
   * canvas/renderer of its own (that lives in a provider, e.g. the browser preview pipeline), so it stays
   * pure and testable with a fake renderer. */
  render: (edit: Partial<PhotoEdit>, masks: Mask[]) => Promise<Pixels>;
  /** The photo before this action, for the closed-loop check. */
  original: Pixels;
  /** How many times to retry at a reduced strength before accepting whatever the last attempt produced. */
  maxRetries?: number;
  /** Additional caller checks on the exact composed recipe. */
  verifyCandidate?: (after: Pixels) => CourseCorrection;
  /** Grain (luminance) denoise per unit of colour denoise strength, so each region's grain moves with its strength. */
  luminancePerStrength?: number;
  signal?: AbortSignal;
}

export interface DenoiseActionResult {
  edit: Partial<PhotoEdit>;
  masks: Mask[];
  verification: CourseCorrection;
  /** 1 means it passed on the first try. */
  attempts: number;
  /** With a subject: what TrueDetail's regional guardian chose for each region, and why a region kept the original. */
  regions?: RegionChoice[];
}

/** How far the eye protection reaches around a detected eye: the eye ring and the feathers at its rim. */
export const EYE_PROTECTION_REACH = 2.6;

const noiseEdit = (strength: number, lumaPerStrength: number) => {
  const luma = Math.round(Math.min(2, strength * lumaPerStrength) * 1e4) / 1e4;
  return { denoise: strength, ...(luma > 0 ? { denoiseLuminance: luma } : {}) };
};

/** The stored TrueDetail regional recipe: background, subject and eye layers, each with its own strength. */
export function regionalDenoiseMasks(subject: SubjectInput, strengths: Record<DenoiseRegion, number>, lumaPerStrength = 0): Mask[] {
  const base = createSubjectMask(subject.maskId, subject.grid, subject.framingKey, subject.confidence, subject.detail);
  return [
    { ...base, id: `${subject.maskId}-background`, invert: true, edit: noiseEdit(strengths.background, lumaPerStrength) },
    { ...base, edit: noiseEdit(strengths.subject, lumaPerStrength) },
    ...(subject.eyes ?? []).map((eye, i): Mask => ({
      id: `${subject.maskId}-eye-${i + 1}`, kind: 'radial', cx: eye.x, cy: eye.y,
      rx: eye.radius * EYE_PROTECTION_REACH, ry: eye.radius * EYE_PROTECTION_REACH, angle: 0,
      invert: false, feather: 0.5, edit: noiseEdit(strengths.eyes, lumaPerStrength),
    })),
  ];
}

/** Runs denoise as a real, verified, retryable action through the engine's task manager. */
export async function runDenoiseAction(input: DenoiseActionInput): Promise<DenoiseActionResult> {
  return runEngineTask('denoise', 'device', 'Denoising', async () => {
    const maxRetries = input.maxRetries ?? 2;
    const lumaPerStrength = input.luminancePerStrength ?? 0;
    const subjectInput = input.subject;
    const { width, height } = input.original;
    let { background, subject } = splitDenoiseBySubject(input.backgroundDenoise);
    let eyes = subject;
    let regions: RegionChoice[] | undefined;
    const sized = !!subjectInput && subjectInput.alpha.length === width * height;
    if (subjectInput && sized) {
      // TrueDetail: each region takes the strongest candidate that beats the original there, judged on its own pixels.
      const eyeAlpha = subjectInput.eyes?.length ? new Float32Array(width * height) : undefined;
      if (eyeAlpha) for (const mask of regionalDenoiseMasks(subjectInput, { background: 0, subject: 0, eyes: 0 }).slice(2)) {
        const a = maskAlpha(mask, width, height, fullContext(width, height));
        for (let p = 0; p < a.length; p++) eyeAlpha[p] = Math.max(eyeAlpha[p], a[p]);
      }
      const weights = regionWeights(subjectInput.alpha, eyeAlpha);
      regions = await chooseRegions(input.original, [
        { region: 'background', weight: weights.background },
        { region: 'subject', weight: weights.subject },
        ...(weights.eyes ? [{ region: 'eyes' as const, weight: weights.eyes }] : []),
      ], Math.max(0, Math.min(2, input.backgroundDenoise)), async (strength) => {
        input.signal?.throwIfAborted();
        return input.render({ denoise: 0 }, regionalDenoiseMasks(subjectInput, { background: strength, subject: strength, eyes: strength }, lumaPerStrength));
      });
      const pick = (region: DenoiseRegion) => regions!.find(r => r.region === region)?.strength ?? 0;
      background = pick('background'); subject = pick('subject');
      // Without a measured eye, the eye layer is absent; with one, it is never stronger than the subject around it.
      eyes = Math.min(subject, weights.eyes ? pick('eyes') : subject);
      if (!background && !subject && !eyes) {
        return { edit: {}, masks: [], attempts: 1, regions,
          verification: { ok: false, reasons: ['No denoise candidate improved on the original in any region.'], suggestedStrengthScale: 0 } };
      }
    }
    let edit: Partial<PhotoEdit> = {};
    let masks: Mask[] = [];
    let verification: CourseCorrection = { ok: false, reasons: [], suggestedStrengthScale: 1 };
    let attempts = 0;

    for (; attempts <= maxRetries; attempts += 1) {
      edit = { denoise: subjectInput ? 0 : background };
      masks = subjectInput ? regionalDenoiseMasks(subjectInput, { background, subject, eyes }, lumaPerStrength) : [];
      input.signal?.throwIfAborted();
      const after = await input.render(edit, masks);
      input.signal?.throwIfAborted();
      verification = verifyEdit(input.original, after, subjectInput?.alpha);
      if (subjectInput && sized && after.width === width && after.height === height && after.data.length === input.original.data.length) {
        const evidence = regionalDetailEvidence(input.original, after, subjectInput.alpha);
        if (evidence.regions && (evidence.ratio < 0.75 || evidence.worstRegion < 0.6)) {
          verification = { ok: false, reasons: [...verification.reasons, 'Denoise removed too much structure from a protected subject.'], suggestedStrengthScale: Math.min(0.5, verification.suggestedStrengthScale) };
        }
      }
      if (input.verifyCandidate) {
        const composed = input.verifyCandidate(after);
        if (!composed.ok) verification = { ok: false, reasons: [...verification.reasons, ...composed.reasons], suggestedStrengthScale: Math.min(verification.suggestedStrengthScale, composed.suggestedStrengthScale) };
      }
      if (verification.ok || attempts === maxRetries) break;
      background = Math.max(0, background * verification.suggestedStrengthScale);
      subject = Math.max(0, subject * verification.suggestedStrengthScale);
      eyes = Math.max(0, eyes * verification.suggestedStrengthScale);
    }
    return { edit: verification.ok ? edit : {}, masks: verification.ok ? masks : [], verification, attempts: attempts + 1, ...(regions ? { regions } : {}) };
  });
}

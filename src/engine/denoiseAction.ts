import { createSubjectMask, type Mask, type SubjectGrid, type SubjectDetail } from '../core/maskTypes';
import type { Pixels } from '../core/colourCheck';
import type { PhotoEdit } from '../core/photoEdits';
import { verifyEdit, type CourseCorrection } from './enhancementVerifier';
import { regionalDetailEvidence } from './regionalDetailGuard';
import { runEngineTask } from './taskManager';

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
  signal?: AbortSignal;
}

export interface DenoiseActionResult {
  edit: Partial<PhotoEdit>;
  masks: Mask[];
  verification: CourseCorrection;
  /** 1 means it passed on the first try. */
  attempts: number;
}

/** Runs denoise as a real, verified, retryable action through the engine's task manager. */
export async function runDenoiseAction(input: DenoiseActionInput): Promise<DenoiseActionResult> {
  return runEngineTask('denoise', 'device', 'Denoising', async () => {
    const maxRetries = input.maxRetries ?? 2;
    let { background, subject } = splitDenoiseBySubject(input.backgroundDenoise);
    let edit: Partial<PhotoEdit> = {};
    let masks: Mask[] = [];
    let verification: CourseCorrection = { ok: false, reasons: [], suggestedStrengthScale: 1 };
    let attempts = 0;

    for (; attempts <= maxRetries; attempts += 1) {
      edit = { denoise: input.subject ? 0 : background };
      masks = input.subject
        ? [
          { ...subjectDenoiseMask(`${input.subject.maskId}-background`, input.subject.grid, input.subject.framingKey, input.subject.confidence, background, input.subject.detail), invert: true },
          subjectDenoiseMask(input.subject.maskId, input.subject.grid, input.subject.framingKey, input.subject.confidence, subject, input.subject.detail),
        ]
        : [];
      input.signal?.throwIfAborted();
      const after = await input.render(edit, masks);
      input.signal?.throwIfAborted();
      verification = verifyEdit(input.original, after, input.subject?.alpha);
      if (input.subject && input.subject.alpha.length === input.original.width * input.original.height && after.width === input.original.width && after.height === input.original.height && after.data.length === input.original.data.length) {
        const evidence = regionalDetailEvidence(input.original, after, input.subject.alpha);
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
    }
    return { edit: verification.ok ? edit : {}, masks: verification.ok ? masks : [], verification, attempts: attempts + 1 };
  }, { signal: input.signal });
}

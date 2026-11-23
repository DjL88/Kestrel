import { createSubjectMask, type Mask, type SubjectGrid, type SubjectDetail, type LocalKey } from '../core/maskTypes';
import type { Pixels } from '../core/colourCheck';
import type { PhotoEdit } from '../core/photoEdits';
import type { EngineCapability, EngineRunner } from './types';
import { verifyEdit, type CourseCorrection } from './enhancementVerifier';
import { runEngineTask } from './taskManager';

/**
 * A Look is a named macro: an ordered sequence of engine steps run as one thing (owner direction, 22 Nov
 * 2026: "Custom Looks could be a thing. Like an automation/macro of 'do this then that'. User sets but
 * also our intelligence could utilise."). Two sources for the same type:
 *  - a person builds one by hand (`createCustomLook`) and it is saved like any other preset;
 *  - the engine proposes one itself, e.g. the Decision Maker noticing a photo would benefit from
 *    "lift the subject, soften the background" and assembling the matching steps (NOT built yet - this
 *    file gives the engine-suggested path the same `source: 'engine-suggested'` tag a UI can use to show
 *    "Claude suggests..." rather than treating it as a plain saved preset).
 *
 * Each step still goes through the same decide -> render -> verify -> retry discipline as
 * `denoiseAction.ts`'s single-capability action; this module generalises that pattern to a sequence of
 * steps and to any of the per-mask `LocalKey` fields (texture/clarity/sharpen/denoise/...), not just
 * denoise. Steps that touch the subject are verified with `detailScope: 'subject'`
 * (`enhancementVerifier.ts`), so a step that deliberately softens the background is judged on whether it
 * protected the subject, not on the background change it was asked to make.
 *
 * Each candidate renders the accumulated accepted recipe against the original source. A failed\n * step is excluded, so the final pixels always match the accepted combined recipe.\n */

export interface LookStep {
  /** Shown in the task manager and to the person reviewing what a Look did. */
  label: string;
  capability: EngineCapability;
  /** The whole-photo edit this step applies (merged into one PhotoEdit across all of a Look's steps when
   * it finally renders - see `runLook`). */
  background: Partial<PhotoEdit>;
  /** When given, applied only to the subject mask instead of `background` for this step - e.g. keep the
   * subject sharp while the background step blurs everything else. */
  subject?: Partial<Record<LocalKey, number>>;
}

export type LookSource = 'builtin' | 'user' | 'engine-suggested';

export interface Look {
  id: string;
  name: string;
  description: string;
  steps: LookStep[];
  source: LookSource;
}

export interface LookSubjectInput {
  maskId: string;
  grid: SubjectGrid;
  framingKey: string;
  confidence: 'high' | 'medium' | 'low';
  detail?: SubjectDetail | null;
  /** 0-1 per pixel, same size as the render - reused by enhancementVerifier.ts's subject-scoped checks. */
  alpha: Float32Array;
}

export interface LookRenderInput {
  render: (edit: Partial<PhotoEdit>, masks: Mask[]) => Promise<Pixels>;
  original: Pixels;
  subject?: LookSubjectInput;
  maxRetriesPerStep?: number;
}

export interface LookStepResult {
  label: string;
  edit: Partial<PhotoEdit>;
  masks: Mask[];
  verification: CourseCorrection;
  attempts: number;
}

export interface LookResult {
  look: Pick<Look, 'id' | 'name'>;
  steps: LookStepResult[];
  finalPixels: Pixels;
  /** The full accepted recipe that produced finalPixels, not just the final step. */
  combinedEdit: Partial<PhotoEdit>;
  combinedMasks: Mask[];
}

/** Scales every numeric field of an edit object by `scale`, leaving any non-numeric field (such as
 * `PhotoEdit.masks`) untouched. Generic over both `Partial<PhotoEdit>` (a step's `background`) and
 * `Partial<Record<LocalKey, number>>` (a step's `subject`), since both are "a few named numeric knobs". */
function scaleLocalEdit<T extends object>(edit: T, scale: number): T {
  const scaled = { ...edit } as Record<string, unknown>;
  for (const key of Object.keys(scaled)) {
    const value = scaled[key];
    if (typeof value === 'number') scaled[key] = value * scale;
  }
  return scaled as T;
}

/** Render each step as part of the accumulated accepted recipe. The render adapter
 * receives the whole edit and all accepted masks, always against the same original
 * source. Never return the pixels of only the last isolated step. A rejected step
 * cannot silently alter the final image. */
export async function runLook(look: Look, input: LookRenderInput, runner: EngineRunner = 'device'): Promise<LookResult> {
  const maxRetries = Math.max(0, Math.min(10, Math.floor(input.maxRetriesPerStep ?? 2)));
  const results: LookStepResult[] = [];
  let finalPixels = input.original;
  let combinedEdit: Partial<PhotoEdit> = {};
  let combinedMasks: Mask[] = [];

  for (const step of look.steps) {
    const stepResult = await runEngineTask(step.capability, runner, `${look.name}: ${step.label}`, async () => {
      let background = { ...step.background };
      let subjectEdit = step.subject ? { ...step.subject } : undefined;
      let masks: Mask[] = [];
      let verification: CourseCorrection = { ok: false, reasons: [], suggestedStrengthScale: 1 };
      let attempts = 0;
      let after = finalPixels;

      for (; attempts <= maxRetries; attempts += 1) {
        masks = [];
        if (input.subject && subjectEdit) {
          const mask = createSubjectMask(input.subject.maskId, input.subject.grid, input.subject.framingKey, input.subject.confidence, input.subject.detail);
          masks = [{ ...mask, id: `${mask.id}-look-${results.length}`, edit: { ...mask.edit, ...subjectEdit } }];
        }
        const candidateEdit = { ...combinedEdit, ...background };
        after = await input.render(candidateEdit, [...combinedMasks, ...masks]);
        const detailScope = input.subject && subjectEdit ? 'subject' : 'frame';
        verification = verifyEdit(input.original, after, input.subject?.alpha, detailScope);
        if (verification.ok || attempts === maxRetries) break;
        background = scaleLocalEdit(background, verification.suggestedStrengthScale);
        if (subjectEdit) subjectEdit = scaleLocalEdit(subjectEdit, verification.suggestedStrengthScale);
      }
      return { edit: background, masks, verification, attempts: attempts + 1, pixels: after };
    });

    results.push({ label: step.label, edit: stepResult.edit, masks: stepResult.masks, verification: stepResult.verification, attempts: stepResult.attempts });
    if (stepResult.verification.ok) {
      combinedEdit = { ...combinedEdit, ...stepResult.edit };
      combinedMasks = [...combinedMasks, ...stepResult.masks];
      finalPixels = stepResult.pixels;
    }
  }

  return { look: { id: look.id, name: look.name }, steps: results, finalPixels, combinedEdit, combinedMasks };
}

/** Builds a Look a person saved from the editor - same shape the engine itself uses, so a hand-made Look
 * and an engine-suggested one are interchangeable everywhere a Look is accepted. */
export function createCustomLook(id: string, name: string, description: string, steps: LookStep[]): Look {
  return { id, name, description, steps, source: 'user' };
}

/** One real built-in Look: lift the subject's fine detail, then soften the background behind it. This is
 * the exact pairing the owner named twice ("lift the subject and add detail. Dull the background and
 * blur"; "denoise within masking... enhancing a subject is different to a background"). Amounts are a
 * first cut, not calibrated against real photos - they exist to prove the two-step, subject-aware
 * pipeline end to end, not as a tuned preset. */
export const LIFT_SUBJECT_BLUR_BACKGROUND: Look = {
  id: 'lift-subject-blur-background',
  name: 'Lift subject, blur background',
  description: 'Adds clarity and sharpening to the subject while softening and denoising everything behind it.',
  source: 'builtin',
  steps: [
    {
      label: 'Soften the background',
      capability: 'denoise',
      background: { denoise: 0.6, texture: -0.4 },
      subject: { denoise: 0, texture: 0.3, clarity: 0.2, sharpen: 0.15 },
    },
  ],
};

/** Named catalogue the UI/engine can list and pick from by id. Grows as more built-in Looks are added;
 * user-made and engine-suggested Looks live wherever the app persists presets today, not here. */
export const BUILTIN_LOOKS: Look[] = [LIFT_SUBJECT_BLUR_BACKGROUND];

export function findBuiltinLook(id: string): Look | undefined {
  return BUILTIN_LOOKS.find((look) => look.id === id);
}

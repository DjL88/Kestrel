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
 * Each accepted step is accumulated into a combined recipe rendered against the ORIGINAL image, rather than chaining onto
 * the previous step's pixels. "Do this, THEN that" means "apply these edits together as one
 * combined pass", not a true multi-pass pipeline where step 2 sees step 1's result. A
 * single combined pass is enough to express every Look below (they are all one coherent whole-photo +
 * subject edit), but a Look whose later step genuinely depends on an earlier step's rendered pixels
 * (rather than just a different numeric target) would need that chaining built first.
 */

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
  /** The final whole-photo recipe containing only verified, accepted Look steps. Consumers may apply it as one undoable edit. */
  combinedEdit: Partial<PhotoEdit>;
  /** The subject masks accepted into the same final rendering; rejected attempts never appear here. */
  combinedMasks: Mask[];
  finalPixels: Pixels;
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

/** A Look has one subject selection. Reusing its id in later steps must update the
 * same layer rather than stack duplicate masks (which would apply earlier adjustments twice). */
function mergeLookMasks(existing: Mask[], incoming: Mask[]): Mask[] {
  const merged = [...existing];
  for (const mask of incoming) {
    const index = merged.findIndex(previous => previous.id === mask.id);
    if (index < 0) merged.push(mask);
    else merged[index] = { ...merged[index], edit: { ...merged[index].edit, ...mask.edit } };
  }
  return merged;
}

/** Runs a Look's steps in order, each one rendered, verified and retried at reduced strength on
 * overshoot - `denoiseAction.ts`'s single-action loop, generalised to a named sequence of steps that can
 * each touch different PhotoEdit fields and each judge itself against the subject or the whole frame.
 *
 * Each trial is rendered as the cumulative accepted recipe against the original pixels. Rejected
 * steps never enter the cumulative recipe. finalPixels therefore represents all accepted steps. */
export async function runLook(look: Look, input: LookRenderInput, runner: EngineRunner = 'device'): Promise<LookResult> {
  // The verifier must never compare pixels against a malformed source frame.
  // Validate before allocating masks or calling any renderer (including empty Looks).
  const { width, height, data } = input.original;
  const pixelCount = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || !Number.isSafeInteger(pixelCount) ||
      !Number.isSafeInteger(pixelCount * 4) ||
      !(data instanceof Uint8ClampedArray) || data.length !== pixelCount * 4) {
    throw new RangeError('Look original must contain valid dimensions and RGBA pixels');
  }
  // Refuse malformed recipes before any render: NaN/Infinity can poison pixel maths
  // and must never enter an accepted, persistent edit recipe.
  for (const step of look.steps) {
    for (const value of Object.values(step.background)) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new RangeError('Look contains a non-finite whole-photo adjustment');
      }
    }
    for (const value of Object.values(step.subject ?? {})) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new RangeError('Look contains a non-finite subject adjustment');
      }
    }
  }
  // A subject-only adjustment must not silently become a no-op when detection is absent.
  if (!input.subject && look.steps.some(step => step.subject && Object.keys(step.subject).length > 0)) {
    throw new RangeError('Look requires a subject selection for subject adjustments');
  }
  if (input.subject) {
    const { alpha } = input.subject;
    if (alpha.length !== pixelCount ||
        alpha.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new RangeError('Look subject alpha must match original pixels and contain values from 0 to 1');
    }
  }
  if (input.maxRetriesPerStep !== undefined && (!Number.isInteger(input.maxRetriesPerStep) || input.maxRetriesPerStep < 0)) {
    throw new RangeError('Look retry count must be a non-negative integer');
  }
  const maxRetries = input.maxRetriesPerStep ?? 2;
  const results: LookStepResult[] = [];
  let finalPixels = input.original;
  let acceptedEdit: Partial<PhotoEdit> = {};
  let acceptedMasks: Mask[] = [];

  for (const step of look.steps) {
    const stepResult = await runEngineTask(step.capability, runner, `${look.name}: ${step.label}`, async () => {
      let background = { ...step.background };
      let subjectEdit = step.subject ? { ...step.subject } : undefined;
      let masks: Mask[] = [];
      let verification: CourseCorrection = { ok: false, reasons: [], suggestedStrengthScale: 1 };
      let attempts = 0;
      let after = input.original;
      let candidateMasks: Mask[] = [];

      for (; attempts <= maxRetries; attempts += 1) {
        masks = [];
        if (input.subject && subjectEdit) {
          const mask = createSubjectMask(input.subject.maskId, input.subject.grid, input.subject.framingKey, input.subject.confidence, input.subject.detail);
          masks = [{ ...mask, edit: { ...mask.edit, ...subjectEdit } }];
        }
        candidateMasks = mergeLookMasks(acceptedMasks, masks);
        after = await input.render({ ...acceptedEdit, ...background }, candidateMasks);
        // Verification compares matching RGBA pixels. Never accept a truncated,
        // resized or malformed render as evidence of a safe, undoable recipe.
        const expectedLength = input.original.width * input.original.height * 4;
        if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0 ||
            after.width !== input.original.width || after.height !== input.original.height ||
            !(after.data instanceof Uint8ClampedArray) || after.data.length !== expectedLength) {
          throw new RangeError('Look renderer returned invalid pixel dimensions or RGBA data');
        }
        const detailScope = input.subject && subjectEdit ? 'subject' : 'frame';
        verification = verifyEdit(input.original, after, input.subject?.alpha, detailScope);
        if (verification.ok || attempts === maxRetries) break;
        background = scaleLocalEdit(background, verification.suggestedStrengthScale);
        if (subjectEdit) subjectEdit = scaleLocalEdit(subjectEdit, verification.suggestedStrengthScale);
      }
      return { edit: background, masks, candidateMasks, verification, attempts: attempts + 1, pixels: after };
    });

    results.push({ label: step.label, edit: stepResult.edit, masks: stepResult.masks, verification: stepResult.verification, attempts: stepResult.attempts });
    if (stepResult.verification.ok) {
      acceptedEdit = { ...acceptedEdit, ...stepResult.edit };
      acceptedMasks = stepResult.candidateMasks;
      finalPixels = stepResult.pixels;
    }
  }

  return {
    look: { id: look.id, name: look.name },
    steps: results,
    combinedEdit: acceptedEdit,
    combinedMasks: acceptedMasks,
    finalPixels,
  };
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

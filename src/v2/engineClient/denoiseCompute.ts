import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import type { Mask } from '../../core/maskTypes';
import type { Pixels } from '../../core/colourCheck';
import type { CourseCorrection } from '../../engine/enhancementVerifier';
import { assessDenoiseCandidate, type LearnedBlend } from '../../engine/denoiseAction';
import { fullContext } from '../../core/masks';
import { blendLearned, trueDetailAiWeight } from '../../core/trueDetailAi';
import { estimateNoiseSigma } from '../../core/noiseEstimate';
import { composeDenoiseRecipe, renderDenoiseRecipe, verifyDenoiseRecipe } from './denoiseRecipe';

/**
 * The pixel-heavy half of V2 denoise, as plain functions with no DOM: measuring noise, rendering each candidate recipe
 * and checking it. `runDenoise.ts` calls it through `providers/denoiseOffThread.ts`, which runs it in a Web Worker
 * (`providers/denoiseWorker.ts`) and only falls back to calling it directly where Workers are unavailable. Both paths
 * run this same code, so they give the same pixels and the same verdicts.
 */

/** Everything one photo's denoise needs, fixed for the whole job. The original pixels arrive already provenance-checked. */
export interface DenoiseJob {
  /** Working-size, framed pixels of the verified source. */
  original: Pixels;
  /** The photo's recipe before this job. */
  baseEdit: PhotoEdit | undefined;
  /** Id of the automatic denoise mask pair this job replaces. */
  recipeId: string;
  /** Individual subject layers this job adds in front of the automatic pair. */
  newLayers: Mask[];
  lumaPerStrength: number;
  /** Subjects that must not lose detail individually. */
  subjects: Mask[];
  /** Combined subject alpha at working size, when subject protection is in use. */
  subjectAlpha?: Float32Array;
  /** TrueDetail: a learned denoiser's result drawn into a working-size picture (transparent outside the subject's area). */
  learned?: Uint8ClampedArray;
}

export interface DenoiseSession {
  /** The photo as it looks with its current recipe: what every candidate is judged against. */
  baseline: Pixels;
  render(edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend): Pixels;
  /** One attempt's verdict, by exactly `runDenoiseAction`'s rules. */
  assess(edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend): CourseCorrection;
  /** Whether the recipe the editor would save passes the per-subject check (used to re-check a cloud result). */
  composedOk(edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend): boolean;
}

export function openDenoiseSession(job: DenoiseJob): DenoiseSession {
  const baseline = renderDenoiseRecipe(job.original, job.baseEdit ?? DEFAULT_EDIT);
  const { original } = job;
  const render = (edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend): Pixels => {
    const recipe = composeDenoiseRecipe(job.baseEdit, job.recipeId, edit.denoise ?? 0, [...job.newLayers, ...masks], job.lumaPerStrength);
    if (!blend || !job.learned) return renderDenoiseRecipe(original, recipe);
    // The learned result goes in first, on the photo's own pixels, exactly as the saved recipe draws it.
    const data = new Uint8ClampedArray(original.data);
    blendLearned(data, job.learned, trueDetailAiWeight({ maskId: job.recipeId, ...blend }, recipe.masks, original.width, original.height, fullContext(original.width, original.height)));
    return renderDenoiseRecipe({ data, width: original.width, height: original.height }, recipe);
  };
  const composed = (after: Pixels) => verifyDenoiseRecipe(baseline, after, job.subjects);
  return {
    baseline,
    render,
    assess: (edit, masks, blend) => assessDenoiseCandidate(baseline, render(edit, masks, blend), job.subjectAlpha, composed),
    composedOk: (edit, masks, blend) => composed(render(edit, masks, blend)).ok,
  };
}

/** Messages to the worker. Every request carries an id, answered once by a reply with the same id. */
export type DenoiseWorkerRequest =
  | { id: number; type: 'noise'; rgba: Uint8ClampedArray; width: number; height: number }
  | { id: number; type: 'open'; session: number; job: DenoiseJob }
  | { id: number; type: 'render' | 'assess' | 'composed'; session: number; edit: Partial<PhotoEdit>; masks: Mask[]; blend?: LearnedBlend }
  | { id: number; type: 'close'; session: number };

export type DenoiseWorkerReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; message: string };

export interface DenoiseWorkerState { sessions: Map<number, DenoiseSession> }

export function createDenoiseWorkerState(): DenoiseWorkerState {
  return { sessions: new Map() };
}

const copyPixels = (pixels: Pixels): Pixels => ({ data: new Uint8ClampedArray(pixels.data), width: pixels.width, height: pixels.height });

/** The worker's whole behaviour, kept here so it is unit-tested with the same structured-clone round trip. */
export function handleDenoiseWorkerMessage(state: DenoiseWorkerState, request: DenoiseWorkerRequest): { reply: DenoiseWorkerReply; transfer: Transferable[] } {
  try {
    switch (request.type) {
      case 'noise':
        return { reply: { id: request.id, ok: true, value: estimateNoiseSigma(request.rgba, request.width, request.height) }, transfer: [] };
      case 'open': {
        const session = openDenoiseSession(request.job);
        state.sessions.set(request.session, session);
        // The worker keeps its own baseline for judging; the copy goes back for the cloud upload.
        const baseline = copyPixels(session.baseline);
        return { reply: { id: request.id, ok: true, value: baseline }, transfer: [baseline.data.buffer] };
      }
      case 'close':
        state.sessions.delete(request.session);
        return { reply: { id: request.id, ok: true, value: null }, transfer: [] };
      default: {
        const session = state.sessions.get(request.session);
        if (!session) throw new Error('This denoise job is no longer open.');
        if (request.type === 'render') {
          const pixels = session.render(request.edit, request.masks, request.blend);
          return { reply: { id: request.id, ok: true, value: pixels }, transfer: [pixels.data.buffer] };
        }
        const value = request.type === 'assess' ? session.assess(request.edit, request.masks, request.blend) : session.composedOk(request.edit, request.masks, request.blend);
        return { reply: { id: request.id, ok: true, value }, transfer: [] };
      }
    }
  } catch (error) {
    return { reply: { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) }, transfer: [] };
  }
}

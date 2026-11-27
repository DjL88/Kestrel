import { engineScheduler, type SchedulerTicket } from '../../core/engineScheduler';
import { MAX_WHY_NOTES, recordEdit, stepEdit, type EditWhy } from '../../core/editHistory';
import { planFinish, type FinishPlan, type FinishRequest } from '../../core/finishPlan';
import { rawJpegPairs } from '../../core/rawJpegPairs';
import { sameRecipe } from '../../core/naturalAuto';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import type { CullingState, PhotoFrame } from '../../core/types';
import { v2Text } from '../../i18n/areas/v2';
import { autoUnavailableSentence, isAutoUnavailable, type AutoUnavailable } from './autoUnavailable';
import { composeDenoiseRecipe } from './denoiseRecipe';
import { readEditGroups, syncEditGroup } from './editGroupState';
import type { DenoiseOutcome } from './runDenoise';
import type { AutoRun } from './runAuto';

/**
 * "Finish my best": the photos src/core/finishPlan.ts chose, edited best first in ONE batch through the shared engine
 * scheduler (so the Tasks panel shows the counts and the time left, and Pause and Cancel work between photos).
 *
 * Each photo goes through the same checks as one press of Auto: Auto's own quality gates, then the vision guardian when
 * the on-device model is installed. A change is applied only when they pass, never forced. Denoise runs only where noise
 * is visible (its own measurement decides) and is folded into the SAME recipe, so a photo is exactly one Undo step.
 * Nothing is rejected, removed or discarded here, nothing is sent anywhere, and originals are never written.
 */

/** A photo at or under this ISO is not tried for noise: it costs a full-size read to find nothing. Said on the result. */
export const LOW_ISO_NO_DENOISE = 400;

export type FinishState = 'applied' | 'held' | 'unchanged' | 'unavailable' | 'failed' | 'skipped';

export interface FinishResult {
  photoId: string;
  filename: string;
  state: FinishState;
  /** What was changed, in one line (applied only). */
  applied?: string;
  /** Why: what passed, or why the photo was left as it was. Always set. */
  why: string;
  /** Set when the checks held the photo back for the person to look at. */
  heldReason?: string;
  denoised: boolean;
  /** When the one edit step was recorded, so Undo takes back only that step. */
  at?: number;
  review: 'pending' | 'kept' | 'undone';
  /** Set when Undo was refused because the person edited the photo again since: History is the way back then. */
  changedSince?: boolean;
}

/** Everything the batch needs from the app, so the flow is tested without a browser. */
export interface FinishDeps {
  /** The photo as it is now. */
  frame(photoId: string): PhotoFrame | undefined;
  auto(frame: PhotoFrame, signal: AbortSignal): Promise<AutoRun | AutoUnavailable | null>;
  /** The on-device vision check. True: it was not convinced the edit looks natural. Absent: no vision model, no opinion. */
  holds?(run: AutoRun, signal: AbortSignal): Promise<boolean>;
  /** Null when the photo cannot be read for denoise. */
  denoise(frame: PhotoFrame, signal: AbortSignal): Promise<DenoiseOutcome | null>;
  /** Save the one recipe. False when the photo changed first, so nothing was applied. */
  commit(examined: PhotoFrame, edit: PhotoEdit, why: EditWhy, at: number): Promise<boolean>;
  now(): number;
  stage?(text: string): void;
}

const alreadyEdited = (frame: PhotoFrame): boolean => Boolean(frame.edit) || Boolean(frame.editHistory?.steps.length);

/**
 * One photo, start to finish. Never throws for a photo-level problem (it is recorded in the result and shown in the
 * review); it does rethrow a cancel, so Cancel stops the batch at once.
 */
export async function finishOne(photoId: string, filename: string, deps: FinishDeps, signal: AbortSignal): Promise<FinishResult> {
  const words = v2Text.finishBest;
  const result = (state: FinishState, why: string, extra: Partial<FinishResult> = {}): FinishResult =>
    ({ photoId, filename, state, why, denoised: false, review: 'pending', ...extra });
  const frame = deps.frame(photoId);
  if (!frame || frame.removedAt != null) return result('skipped', words.editedMeanwhile);
  // Edited since the plan was made (by hand, or by Auto-pilot): that look is the photographer's.
  if (alreadyEdited(frame)) return result('skipped', words.editedMeanwhile);
  try {
    deps.stage?.(words.lookStage);
    const run = await deps.auto(frame, signal);
    signal.throwIfAborted();
    if (!run) return result('unchanged', v2Text.autoCheck.failed(filename));
    if (isAutoUnavailable(run)) return result('unavailable', autoUnavailableSentence(run.unavailable, filename));

    let edit: PhotoEdit = frame.edit ?? DEFAULT_EDIT;
    const lines: string[] = [];
    const notes: string[] = [];
    if (run.improved) {
      if (await deps.holds?.(run, signal)) {
        // Held: nothing at all is applied to this photo, including noise reduction, and the suggestion is not kept: pressing
        // Auto on the photo makes it again, in any assist mode.
        const reason = words.heldReason;
        return result('held', reason, { heldReason: reason });
      }
      signal.throwIfAborted();
      edit = run.plan.proposal;
      const summary = run.candidates.find((candidate) => candidate.edit === run.plan.proposal)?.summary;
      if (summary) lines.push(summary);
      notes.push(words.whyApplied, ...run.detail);
    }

    // Noise, only where it is visible: runV2Denoise measures it at full size and applies nothing when it is not.
    let noiseNote = '';
    let denoised = false;
    const iso = frame.exif?.iso;
    if (typeof iso === 'number' && iso > 0 && iso <= LOW_ISO_NO_DENOISE) {
      noiseNote = words.lowIso(iso);
    } else {
      deps.stage?.(words.noiseStage);
      try {
        const outcome = await deps.denoise({ ...frame, edit }, signal);
        signal.throwIfAborted();
        if (outcome?.verified && outcome.strength > 0) {
          const base = composeDenoiseRecipe(edit, `auto-denoise-${photoId}`, outcome.strength, outcome.masks,
            outcome.luminance / outcome.strength);
          edit = outcome.trueDetailAi ? { ...base, trueDetailAi: outcome.trueDetailAi } : base;
          denoised = true;
          lines.push(words.noiseReduced);
          notes.push(words.noiseReduced);
        } else if (outcome?.notes[0]) noiseNote = outcome.notes[0];
      } catch (error) {
        signal.throwIfAborted();
        noiseNote = error instanceof Error && error.message ? error.message : words.failed;
      }
    }

    if (sameRecipe(edit, frame.edit ?? DEFAULT_EDIT)) {
      return result('unchanged', [run.headline, noiseNote].filter(Boolean).join(' '));
    }
    const at = deps.now();
    signal.throwIfAborted();
    const saved = await deps.commit(frame, edit, { by: 'auto', notes: notes.slice(0, MAX_WHY_NOTES) }, at);
    if (!saved) return result('skipped', words.notSaved);
    return result('applied', [words.whyApplied, noiseNote].filter(Boolean).join(' '), { applied: lines.join(' '), denoised, at });
  } catch (error) {
    // A cancel is not a failure: it stops the batch.
    if (signal.aborted) throw error;
    return result('failed', words.failed);
  }
}

/**
 * Like commitAutoEdit, for a photo that is NOT the one open on the canvas: compared with the catalogue at write time,
 * and refused when the person edited, reframed, removed or replaced the photo meanwhile. One recorded step.
 */
export function commitFinishEdit(state: CullingState, projectId: string, examined: PhotoFrame, proposal: PhotoEdit, at: number, why?: EditWhy): CullingState {
  if (state.shoot.id !== projectId || alreadyEdited(examined)) return state;
  const index = state.frames.findIndex((frame) => frame.id === examined.id);
  const frame = state.frames[index];
  if (!frame || frame.removedAt != null || alreadyEdited(frame) ||
      frame.framing !== examined.framing || frame.stableKey !== examined.stableKey ||
      frame.originalSha256 !== examined.originalSha256 ||
      readEditGroups(frame).activeId !== readEditGroups(examined).activeId ||
      frame.editVersions?.activeId !== examined.editVersions?.activeId) return state;
  const frames = state.frames.slice();
  frames[index] = syncEditGroup(recordEdit(frame, { edit: proposal }, at, why));
  return { ...state, frames, shoot: { ...state.shoot, lastUpdatedAt: at } };
}

/** True while the batch's own step is still the last one and in force, so Undo takes back exactly that. */
export function canUndoFinish(frame: PhotoFrame | undefined, at: number | undefined): boolean {
  const history = frame?.editHistory;
  if (!frame || frame.removedAt != null || at === undefined || !history) return false;
  return history.cursor === history.steps.length && history.steps[history.cursor - 1]?.at === at;
}

/** One Undo for one photo: the same step History's Undo takes. Later steps stay available to redo. */
export function undoFinish(state: CullingState, photoId: string, at: number): CullingState {
  const index = state.frames.findIndex((frame) => frame.id === photoId);
  if (index < 0 || !canUndoFinish(state.frames[index], at)) return state;
  const frames = state.frames.slice();
  frames[index] = syncEditGroup(stepEdit(frames[index], -1));
  return { ...state, frames, shoot: { ...state.shoot, lastUpdatedAt: Date.now() } };
}

/** What a request would finish: a JPEG kept beside its RAW is not a photo of its own, so only the RAW is counted. */
export function planFinishForCatalogue(frames: readonly PhotoFrame[], request: FinishRequest): FinishPlan<PhotoFrame> {
  const companions = rawJpegPairs(frames).rawOf;
  return planFinish(frames.filter((frame) => !companions.has(frame.id)), request);
}

export interface FinishBatchOptions {
  plan: FinishPlan<PhotoFrame>;
  deps: FinishDeps;
  /** Called as each photo finishes, in plan order, including photos that were left alone. */
  onResult(result: FinishResult): void;
  /** The scheduler to queue on; the app's own unless a test passes one. */
  scheduler?: Pick<typeof engineScheduler, 'submit'>;
}

/**
 * Queue the batch. One scheduler task, one item per photo, so progress, time left, Pause and Cancel are the Tasks
 * panel's own. Photos run one at a time, so the interface stays responsive: Auto's measuring and the denoise pixel work
 * (a worker) hand the thread back between steps, and the scheduler never starts a second heavy job beside it.
 */
export async function submitFinishBatch({ plan, deps, onResult, scheduler = engineScheduler }: FinishBatchOptions): Promise<SchedulerTicket> {
  const words = v2Text.finishBest;
  return scheduler.submit({
    title: words.taskTitle(plan.items.length),
    kind: 'auto-edit', resource: 'cpu', priority: 7, pauseable: true,
    stallMs: 10 * 60_000,
    items: plan.items.map((frame) => ({ id: frame.id, name: frame.filename })),
    snapshot: undefined,
    itemId: (item) => item.id,
    itemLabel: (item) => item.name,
    runItem: async (item, _snapshot, ctx) => {
      const result = await finishOne(item.id, item.name, { ...deps, stage: (text) => ctx.stage(text) }, ctx.signal);
      // The edit is already saved when a result says applied, so it is recorded even if Cancel arrives now.
      onResult(result);
      ctx.checkCancelled();
    },
  });
}

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { SchedulerTicket } from '../../core/engineScheduler';
import { learnedLeanings } from '../../core/editStyle';
import { planFinish, type FinishPlan, type FinishRequest } from '../../core/finishPlan';
import { rawJpegPairs } from '../../core/rawJpegPairs';
import type { CullingState, PhotoFrame } from '../../core/types';
import { guardResult } from '../../core/visionGuardian';
import { v2Text } from '../../i18n/areas/v2';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { hasLocalVision } from '../../providers/localVision';
import { askOnDeviceGuardian } from '../../providers/visionGuardian';
import { guardianOrder } from './assistGuardian';
import { loadEditStyle } from './editStyleStore';
import { finishBatchStore } from './finishBatchStore';
import { renderGalleryPreview } from './galleryPreview';
import { runAuto } from './runAuto';
import { runV2Denoise } from './runDenoise';
import { canUndoFinish, commitFinishEdit, submitFinishBatch, undoFinish, type FinishDeps } from './runFinishBatch';

/** Long edge of a review tile's picture: enough to judge an edit at a glance, cheap to draw for fifty at a time. */
const REVIEW_EDGE = 560;

/** What the workspace hands the actions: the dialog and the buttons use only these. */
export interface FinishBestControl {
  /** The photos a request would finish, best first, and why the others are left alone. Reads the catalogue as it is now. */
  plan: (request: FinishRequest) => FinishPlan<PhotoFrame>;
  /** Queue the batch (one Tasks row). Resolves when it has finished or been stopped. */
  run: (request: FinishRequest) => Promise<void>;
  /** The review's Undo for one photo: only the batch's own step, and only while it is still the last one. */
  undo: (photoId: string) => void;
  /** A small picture of the photo as it was (before) or as it is now (after), as an object URL; null when none can be made. */
  preview: (photoId: string, side: 'before' | 'after') => Promise<string | null>;
  /** Stops the batch at the next photo. Pause and Resume are on the Tasks row. */
  cancel: () => void;
}

interface Inputs {
  stateRef: MutableRefObject<CullingState | null>;
  mutate: (change: (current: CullingState) => CullingState) => void;
  provider: MutableRefObject<BrowserPreviewProvider | null>;
  editStyleOn: boolean;
  say: (text: string) => void;
  projectId: string | undefined;
}

/**
 * "Finish my best" (behind the finishBest flag). The workspace calls this once; everything else is here. Runs on this
 * device only: nothing is uploaded, and the cloud is not used for this (it has its own Cloud edits run).
 */
export function useFinishBest({ stateRef, mutate, provider, editStyleOn, say, projectId }: Inputs): FinishBestControl {
  const ticket = useRef<SchedulerTicket | null>(null);

  // Leaving the project stops the batch and forgets its review: the results belong to the project they were made in.
  useEffect(() => {
    const open = finishBatchStore.getSnapshot();
    if (open.projectId && open.projectId !== projectId) { ticket.current?.cancel(); finishBatchStore.reset(); }
  }, [projectId]);
  useEffect(() => () => { ticket.current?.cancel(); }, []);

  const plan = useCallback((request: FinishRequest): FinishPlan<PhotoFrame> => {
    const frames = stateRef.current?.frames ?? [];
    // A JPEG kept beside its RAW is not a photo of its own.
    const companions = rawJpegPairs(frames).rawOf;
    return planFinish(frames.filter((frame) => !companions.has(frame.id)), request);
  }, [stateRef]);

  const run = useCallback(async (request: FinishRequest): Promise<void> => {
    const state = stateRef.current;
    const words = v2Text.finishBest;
    if (!state || !provider.current || finishBatchStore.getSnapshot().phase === 'running') return;
    const chosen = plan(request);
    if (!chosen.items.length) { say(words.nothing); return; }
    const projectKey = state.shoot.id;
    const frameNow = (id: string) => stateRef.current?.frames.find((frame) => frame.id === id);
    const deps: FinishDeps = {
      frame: frameNow,
      auto: (frame, signal) => runAuto(frame, provider.current!, signal, editStyleOn ? learnedLeanings(loadEditStyle()) : []),
      // The same second opinion Auto-pilot asks: a clear no holds the photo. No on-device vision model, no opinion.
      holds: async (run) => {
        if (!hasLocalVision()) return false;
        const candidate = guardianOrder(run.candidates, run.plan.proposal).find((item) => item.edit === run.plan.proposal);
        if (!candidate) return false;
        const opinion = await askOnDeviceGuardian(candidate.after, 'editNatural');
        return guardResult('apply', opinion ? [opinion] : []).status !== 'apply';
      },
      // Local only: no cloud account is passed, so nothing is uploaded.
      denoise: (frame, signal) => runV2Denoise(frame, provider.current!, null, signal),
      commit: async (examined, edit, why, at) => {
        const current = stateRef.current;
        if (!current) return false;
        const next = commitFinishEdit(current, projectKey, examined, edit, at, why);
        if (next === current) return false;
        stateRef.current = next;
        mutate((latest) => commitFinishEdit(latest, projectKey, examined, edit, at, why));
        return true;
      },
      now: () => Date.now(),
    };
    finishBatchStore.begin(projectKey, chosen.items.length);
    let handle: SchedulerTicket | null = null;
    let outcome: 'done' | 'failed' | 'cancelled' = 'failed';
    try {
      handle = await submitFinishBatch({ plan: chosen, deps, onResult: (result) => finishBatchStore.add(result) });
      ticket.current = handle;
      outcome = await handle.finished;
    } catch {
      outcome = 'failed';
    } finally {
      if (ticket.current === handle) ticket.current = null;
    }
    const results = finishBatchStore.getSnapshot().results;
    finishBatchStore.finish(outcome !== 'done');
    const edited = results.filter((result) => result.state === 'applied').length;
    const held = results.filter((result) => result.state === 'held').length;
    // Never silent: a stop or a failure says how far it got, and the finished photos stay in Review.
    say(outcome === 'done' ? words.doneNotice(results.length, edited, held) : outcome === 'cancelled'
      ? words.cancelledNotice(results.length, chosen.items.length) : words.failed);
  }, [stateRef, provider, plan, say, mutate, editStyleOn]);

  const undo = useCallback((photoId: string) => {
    const result = finishBatchStore.getSnapshot().results.find((item) => item.photoId === photoId);
    const current = stateRef.current;
    if (!result || !current || result.at === undefined || result.review === 'undone') return;
    const frame = current.frames.find((item) => item.id === photoId);
    if (!canUndoFinish(frame, result.at)) { finishBatchStore.mark(photoId, { changedSince: true }); return; }
    const next = undoFinish(current, photoId, result.at);
    stateRef.current = next;
    mutate((latest) => undoFinish(latest, photoId, result.at!));
    finishBatchStore.mark(photoId, { review: 'undone', changedSince: false });
  }, [stateRef, mutate]);

  const preview = useCallback(async (photoId: string, side: 'before' | 'after'): Promise<string | null> => {
    const frame = stateRef.current?.frames.find((item) => item.id === photoId && item.removedAt == null);
    if (!frame || !provider.current) return null;
    // Only photos with no edit and no history are finished, so "before" is the photo with no edit.
    const shown: PhotoFrame = side === 'before' ? { ...frame, edit: undefined } : frame;
    try {
      const blob = await renderGalleryPreview(shown, provider.current, undefined, REVIEW_EDGE);
      return blob ? URL.createObjectURL(blob) : null;
    } catch { return null; }
  }, [stateRef, provider]);

  const cancel = useCallback(() => { ticket.current?.cancel(); }, []);

  return useMemo(() => ({ plan, run, undo, preview, cancel }), [plan, run, undo, preview, cancel]);
}

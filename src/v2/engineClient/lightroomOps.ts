// Bring a Lightroom Classic library into a V2 project: ratings, flags, keywords, collections and basic develop settings
// for the photos already in the project. The catalogue is read with core/lightroomCatalogue (no write path), matched with
// core/lightroomImport (never guessed), and applied here. Choices already made in InFlight are always kept.
import { applyDecisionWithHistory } from '../../core/cullingEngine';
import { recordEdit } from '../../core/editHistory';
import { hasCarriedDevelop, type LightroomDevelop } from '../../core/lightroomCatalogue';
import type { LightroomPlan } from '../../core/lightroomImport';
import { rawJpegPairs, withPartners } from '../../core/rawJpegPairs';
import { addTags } from '../../core/subjectTags';
import type { CullingState } from '../../core/types';
import type { EditRecipe } from '../ui/contract';
import { syncEditGroup } from './editGroupState';
import { applyRecipePatch } from './recipeMap';

export interface LightroomResult {
  /** Project photos that received anything. */
  photos: number;
  edits: number;
  /** Photos where InFlight already had a different choice (rating, flag or edit), which was kept. */
  keptYours: number;
  /** Photos whose Lightroom edit had parts InFlight does not carry over (crop, white balance, masks, an old process). */
  partialEdits: number;
}

/** Lightroom's develop sliders to InFlight's recipe sliders. Both run -100 to 100 and exposure is in EV. */
export function developToRecipe(develop: LightroomDevelop): Partial<EditRecipe> {
  const patch: Partial<EditRecipe> = {};
  const copy = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'clarity', 'vibrance', 'saturation', 'dehaze', 'vignette', 'grain', 'grainSize'] as const;
  for (const key of copy) if (develop[key] !== undefined) patch[key] = develop[key];
  if (develop.monochrome) patch.saturation = -100;
  if (develop.texture !== undefined && develop.texture > 0) patch.detailRecovery = develop.texture;
  if (develop.luminanceNoise !== undefined) patch.denoiseLuminance = develop.luminanceNoise;
  return patch;
}

export function applyLightroomImport(state: CullingState, plan: LightroomPlan, at: number): { state: CullingState; result: LightroomResult } {
  let next = state;
  const pairs = rawJpegPairs(state.frames);
  const touched = new Set<string>();
  const kept = new Set<string>();
  let edits = 0;
  let partialEdits = 0;
  for (const { frameId, photo } of plan.matches) {
    // A paired JPEG shares its RAW's rating, flag and tags; the develop settings belong to the matched file only.
    for (const id of withPartners([frameId], pairs)) {
      const frame = next.frames.find((candidate) => candidate.id === id);
      if (!frame || frame.removedAt != null) continue;
      if (photo.flag) {
        const decision = photo.flag === 'pick' ? 'keep' : 'reject';
        if (frame.decision === 'unreviewed') {
          next = applyDecisionWithHistory(next, id, decision, { allowAdvance: false });
          touched.add(id);
        } else if (frame.decision !== decision) kept.add(id);
      }
      const tags = [...photo.keywords, ...photo.collections];
      next = {
        ...next,
        frames: next.frames.map((candidate) => {
          if (candidate.id !== id) return candidate;
          let updated = candidate;
          if (photo.rating) {
            if (!candidate.rating) { updated = { ...updated, rating: photo.rating }; touched.add(id); }
            else if (candidate.rating !== photo.rating) kept.add(id);
          }
          if (tags.length) {
            const merged = addTags(candidate.tags ?? [], tags);
            if (merged.length !== (candidate.tags ?? []).length) {
              const accepted = new Set(tags.map((tag) => tag.toLowerCase()));
              updated = { ...updated, tags: merged, autoTags: candidate.autoTags?.filter((tag) => !accepted.has(tag.toLowerCase())) };
              touched.add(id);
            }
          }
          if (id === frameId && hasCarriedDevelop(photo.develop)) {
            if (candidate.edit || candidate.editHistory?.steps.length) kept.add(id);
            else {
              // Recorded as one undoable step, so Undo returns the photo to exactly how it was.
              updated = syncEditGroup(recordEdit(updated, { edit: applyRecipePatch(undefined, developToRecipe(photo.develop!)).edit }, at));
              edits++;
              if (photo.develop!.notCarried.length) partialEdits++;
              touched.add(id);
            }
          }
          return updated;
        }),
      };
    }
  }
  return {
    state: touched.size ? { ...next, shoot: { ...next.shoot, lastUpdatedAt: at } } : state,
    result: { photos: touched.size, edits, keptYours: kept.size, partialEdits },
  };
}

type LightroomWords = typeof import('../../i18n/areas/v2/source').source.lightroom;

/** What happened, in plain words: how many came in, which of the person's own choices were kept, and what was left alone. */
export function lightroomNotice(words: LightroomWords, plan: LightroomPlan, catalogued: number, result: LightroomResult): string {
  const parts = [words.done(result.photos, catalogued)];
  if (result.keptYours) parts.push(words.keptYours(result.keptYours));
  if (plan.unmatched) parts.push(words.notFound(plan.unmatched));
  if (result.edits) parts.push(words.editsNote);
  return parts.join(' ');
}

import { tasks } from '../core/taskStore';
import { SPECIES_MODEL } from '../core/speciesModel';
import { gateOutcome } from '../core/categoryGate';
import { rankSpecies } from '../core/speciesMatch';
import type { SpeciesGuess } from '../core/speciesPalette';
import { gateAvailable, routePicture } from './categoryGate';
import { SPECIES_DOWNLOAD_BYTES, downloadSpeciesModel, embedPicture, loadSpeciesLabels, speciesStatus, speciesSubjectCrop } from './speciesModel';

/**
 * Stage two plumbing for Auto: install the species model by itself, with progress in the task manager, and name the
 * subject on this device (BioCLIP-style embedding match, no network once installed). Never throws: any failure
 * means "no species", and Auto carries on without it.
 */

let installing: Promise<boolean> | null = null;

/**
 * Make sure the species model is on this device. The first Auto press starts the install in the background, shown in
 * the task manager with progress and a Stop button; later presses reuse it. Resolves true when the model is usable.
 * Auto never waits for it: the photo is improved now, and the species check joins in on the next press.
 */
export function ensureSpeciesModel(taskTitle: string, doneText: string): Promise<boolean> {
  if (installing) return installing;
  installing = (async () => {
    try {
      const status = await speciesStatus();
      if (status === 'ready') return true;
      if (status === 'unavailable') return false;
      const controller = new AbortController();
      const task = tasks.start(taskTitle, { total: 100, cancel: () => controller.abort() });
      try {
        await downloadSpeciesModel((fraction) => {
          const mb = Math.round((fraction * SPECIES_DOWNLOAD_BYTES) / 1_000_000);
          task.progress(Math.round(fraction * 100), 100, `${mb} of ${Math.round(SPECIES_DOWNLOAD_BYTES / 1_000_000)} MB`);
        }, controller.signal);
        task.finish(doneText);
        return true;
      } catch (error) {
        if ((error as Error).name !== 'AbortError') task.fail(error instanceof Error ? error.message : 'The species model could not be installed.');
        return false;
      }
    } catch { return false; }
  })().finally(() => { installing = null; });
  return installing;
}

/** Re-exported so the editor can show "downloading" without importing providers twice. */
export const speciesModelConfigured = () => Boolean(SPECIES_MODEL.url) || SPECIES_MODEL.bundled;

/**
 * Name the subject in a bounded preview canvas. Returns null unless the model is installed, the category gate says
 * this is an animal, and the answer is not the model forcing its nearest bird onto something else.
 */
export async function identifySubject(picture: HTMLCanvasElement): Promise<SpeciesGuess | null> {
  try {
    if ((await speciesStatus()) !== 'ready' || !(await gateAvailable())) return null;
    const { crop } = await speciesSubjectCrop(picture);
    const route = await routePicture(picture, crop);
    if (gateOutcome(route, 'wildlife').species !== 'allow') return null;
    const [{ labels, vectors }, embedding] = await Promise.all([loadSpeciesLabels(), embedPicture(picture, crop)]);
    const ranked = rankSpecies(embedding, labels, vectors);
    if (!ranked.length) return null;
    return { common: ranked[0].label.common, probability: ranked[0].probability, runnerUp: ranked[1]?.probability ?? 0 };
  } catch { return null; }
}

import type { EditHistory } from './editHistory';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';

/**
 * Auto's own previous contribution, so pressing Auto again REPLACES it instead of stacking on it.
 *
 * Every Auto step in the photo's history records the edit before and after it. Walking those steps backwards
 * (newest first, only the ones still applied), a control that still holds exactly the value Auto left is put back
 * to what it was before Auto; a control the person has moved since is left alone and reported as `kept`, so Auto
 * never overwrites a deliberate change. The masks Auto added are removed only while they are still exactly as Auto
 * made them. Pure: nothing here edits a photo.
 */
export interface AutoLayerResult {
  /** The edit without Auto's previous contribution (the same edit when Auto never ran). */
  base: PhotoEdit;
  /** True when at least one earlier Auto step was taken back out. */
  stripped: boolean;
  /** Controls (and 'masks') the person changed after Auto, which Auto keeps as they are. */
  kept: string[];
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function stripAutoLayer(current: PhotoEdit | undefined, history: EditHistory | undefined): AutoLayerResult {
  const start = current ?? DEFAULT_EDIT;
  if (!history) return { base: start, stripped: false, kept: [] };
  let base: PhotoEdit = { ...start };
  let stripped = false;
  const kept = new Set<string>();
  const applied = history.steps.slice(0, Math.max(0, Math.min(history.cursor, history.steps.length)));
  for (let index = applied.length - 1; index >= 0; index -= 1) {
    const step = applied[index];
    if (step.why?.by !== 'auto') continue;
    const before = (step.before.edit ?? DEFAULT_EDIT) as unknown as Record<string, unknown>;
    const after = (step.after.edit ?? DEFAULT_EDIT) as unknown as Record<string, unknown>;
    const out = base as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (key === 'masks' || same(before[key], after[key])) continue;
      if (same(out[key], after[key])) {
        if (before[key] === undefined) delete out[key]; else out[key] = before[key];
        stripped = true;
      } else kept.add(key);
    }
    const beforeIds = new Set((step.before.edit?.masks ?? []).map((mask) => mask.id));
    const added = (step.after.edit?.masks ?? []).filter((mask) => !beforeIds.has(mask.id));
    if (added.length) {
      const remaining = (base.masks ?? []).filter((mask) => {
        const mine = added.find((candidate) => candidate.id === mask.id);
        if (!mine) return true;
        if (same(mine, mask)) { stripped = true; return false; }
        kept.add('masks');
        return true;
      });
      if (remaining.length) base.masks = remaining; else delete base.masks;
    }
  }
  return { base, stripped, kept: [...kept] };
}

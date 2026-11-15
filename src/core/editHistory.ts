import type { PhotoFrame } from './types';
import { DETAIL_CONTROLS, TONE_CONTROLS, type PhotoEdit } from './photoEdits';
import type { PhotoFraming } from './photoFraming';

type Snapshot = { edit?: PhotoEdit; framing?: PhotoFraming };
export type EditKind = 'light' | 'warmth' | 'colour' | 'adjustments' | 'tone' | 'detail' | 'mask' | 'crop' | 'rotation' | 'straighten';

export const MAX_EDIT_HISTORY_STEPS = 60;

export interface EditHistory {
  cursor: number;
  steps: { kind: EditKind; before: Snapshot; after: Snapshot; at: number }[];
}

function classify(before: Snapshot, after: Snapshot): EditKind {
  if (JSON.stringify(before.framing) !== JSON.stringify(after.framing)) {
    if ((before.framing?.turns ?? 0) !== (after.framing?.turns ?? 0)) return 'rotation';
    if ((before.framing?.straighten ?? 0) !== (after.framing?.straighten ?? 0)) return 'straighten';
    return 'crop';
  }
  if (JSON.stringify(before.edit?.masks ?? []) !== JSON.stringify(after.edit?.masks ?? [])) return 'mask';
  const fields = (['exposure', 'warmth', 'colour', ...TONE_CONTROLS.map(({ key }) => key), ...DETAIL_CONTROLS.map(({ key }) => key)] as const).filter((field) =>
    (before.edit?.[field] ?? 0) !== (after.edit?.[field] ?? 0));
  if (fields.length !== 1) return 'adjustments';
  if (fields[0] === 'exposure') return 'light';
  if (fields[0] === 'warmth' || fields[0] === 'colour') return fields[0];
  return DETAIL_CONTROLS.some(({ key }) => key === fields[0]) ? 'detail' : 'tone';
}

export function recordEdit(frame: PhotoFrame, patch: Snapshot, at: number): PhotoFrame {
  const before = { edit: frame.edit, framing: frame.framing };
  const after = { ...before, ...patch };
  if (JSON.stringify(before) === JSON.stringify(after)) return frame;
  const history = frame.editHistory;
  const steps = history ? history.steps.slice(0, history.cursor) : [];
  const kind = classify(before, after);
  const last = steps.at(-1);
  if (last && history?.cursor === history?.steps.length && last.kind === kind && at >= last.at && at - last.at < 550) {
    steps.pop();
    if (JSON.stringify(last.before) !== JSON.stringify(after)) steps.push({ kind, before: last.before, after, at });
  } else {
    steps.push({ kind, before, after, at });
  }
  const retained = steps.slice(-MAX_EDIT_HISTORY_STEPS);
  return { ...frame, ...after, focusPoint: before.framing === after.framing ? frame.focusPoint : undefined, editHistory: { steps: retained, cursor: retained.length } };
}

export function stepEdit(frame: PhotoFrame, direction: -1 | 1): PhotoFrame {
  const history = frame.editHistory;
  if (!history) return frame;
  const index = direction === -1 ? history.cursor - 1 : history.cursor;
  const step = history.steps[index];
  if (!step) return frame;
  const recipe = direction === -1 ? step.before : step.after;
  return {
    ...frame, edit: recipe.edit, framing: recipe.framing,
    focusPoint: JSON.stringify(frame.framing) === JSON.stringify(recipe.framing) ? frame.focusPoint : undefined,
    editHistory: { ...history, cursor: history.cursor + direction },
  };
}

/** The recipe as it stood with this many steps applied. Zero is the original, before any edit. */
export function recipeAt(history: EditHistory, cursor: number): Snapshot | undefined {
  if (!history.steps.length) return undefined;
  const at = Math.max(0, Math.min(history.steps.length, cursor));
  return at === 0 ? history.steps[0].before : history.steps[at - 1].after;
}

/** Restore the photo to how it was after the given number of steps. Later steps stay available to redo. */
export function jumpToStep(frame: PhotoFrame, cursor: number): PhotoFrame {
  const history = frame.editHistory;
  if (!history) return frame;
  const at = Math.max(0, Math.min(history.steps.length, cursor));
  const recipe = recipeAt(history, at);
  if (!recipe || at === history.cursor) return frame;
  return {
    ...frame, edit: recipe.edit, framing: recipe.framing,
    focusPoint: JSON.stringify(frame.framing) === JSON.stringify(recipe.framing) ? frame.focusPoint : undefined,
    editHistory: { ...history, cursor: at },
  };
}
